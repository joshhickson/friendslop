// The game runner: for a room made from a GitHub source, the game's server hooks run here, in
// the host's browser, and the server only relays (server/remote-match.js). This file builds the
// same `ctx` that server/match.js gives a server-run game, drives the game's hooks from relay
// events, and sends the game's output back as relay batches.
//
// It runs unchanged in Node (the tests) and in a browser worker, so it imports only by relative
// path, uses no Node built-ins, and takes its clock and timers from the caller.

import { C2S, S2C, LIMITS, cleanText, jsonBytes } from '../../shared/protocol.js';
import { COPY } from '../../shared/copy.js';

const MAX_HOOK_ERRORS = 25; // the same limit as Match.call
const MAX_DT = 0.25; // seconds: the same cap as Match's tick
// The server's own caps on stats (server/remote-match.js). The runner keeps to them so its
// numbers and the scoreboard's never disagree.
const STAT_KEY_RE = /^[A-Za-z0-9_]{1,32}$/;
const STAT_TEXT_MAX = 64;
const STAT_KEYS_MAX = 32;

const SILENT = Object.freeze({ debug() {}, info() {}, warn() {}, error() {} });

/** Everything defineGame() returned except create, as plain JSON, plus hasBot. */
export function describeGame(def, { hasBot = false } = {}) {
  const { create, ...rest } = def;
  return { ...JSON.parse(JSON.stringify(rest)), hasBot: hasBot === true };
}

/** A copy of `data` exactly as the wire would carry it. */
const wireCopy = (json) => (json === undefined ? undefined : JSON.parse(json));

class Emitter {
  constructor(log) {
    this.handlers = new Map();
    this.log = log;
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(fn);
    return () => this.handlers.get(type)?.delete(fn);
  }

  emit(type, ...args) {
    for (const fn of [...(this.handlers.get(type) ?? [])]) {
      try {
        fn(...args);
      } catch (err) {
        this.log.error?.(`bot "${type}" handler failed:`, err);
      }
    }
  }
}

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * @param {object} opts
 * @param {object} opts.def        the game's defineGame() output (with create)
 * @param {{ send(msg: object): void }} opts.transport  takes one { t: 'relay', msgs } per flush
 * @param {(gameId: string) => Promise<object|null>} [opts.loadBrain]  the game's bot module
 * @param {{ setInterval: Function, clearInterval: Function }} [opts.timers]
 * @param {() => number} [opts.now]  a monotonic clock in ms
 * @param {object} [opts.log]
 */
export function createRunner({ def, transport, loadBrain = async () => null, timers, now, log = globalThis.console ?? SILENT }) {
  const clock = now ?? (() => globalThis.performance.now());
  const tm = timers ?? {
    setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
    clearInterval: (h) => globalThis.clearInterval(h),
  };

  // ---- what the server last told us about the room's players ----
  let snapshot = null;
  // playerId -> { id, name, team, bot, spectating, connected, ping, ... }: the latest snapshot's
  // entry, patched by the `player` fields of each event that arrived after it.
  let byId = new Map();

  let m = null; // the running match (a fresh object for each `start`)
  let stopped = false;
  let brainModule = null; // the bot module, once it has loaded; a failed load is tried again next match

  // ---- relay output ----
  let queue = []; // { item, json? } items for the next flush
  let deliveries = []; // [match, botId, type, json] for bots this runner runs
  let flushScheduled = false;

  // ---- players, as one match sees them ----

  /** What `match` knows of a player now: the room's latest, or the last it saw (gone, so not connected). */
  function fieldsOf(match, id) {
    const cur = m === match ? byId.get(id) : undefined;
    if (cur) return cur;
    const last = match.last.get(id);
    return last ? { ...last, connected: false } : null;
  }

  function viewFor(match, id) {
    let v = match.views.get(id);
    if (v) return v;
    v = Object.freeze({
      get id() { return id; },
      get name() { return fieldsOf(match, id)?.name ?? ''; },
      get team() { return fieldsOf(match, id)?.team ?? null; },
      get ping() { return fieldsOf(match, id)?.ping ?? 0; },
      get connected() { return fieldsOf(match, id)?.connected ?? false; },
      get bot() { return fieldsOf(match, id)?.bot ?? false; },
      get spectating() {
        if (match.active.has(id)) return false;
        if (match.watchers.has(id)) return true;
        return fieldsOf(match, id)?.spectating ?? false;
      },
      get stats() { return { ...(match.stats.get(id) ?? {}) }; },
    });
    match.views.set(id, v);
    return v;
  }

  /** An event's `player` is the server's word on that player as of the event: it goes in first. */
  function applyPlayer(msg) {
    const p = msg.player;
    if (!isPlain(p) || p.id !== msg.id) return;
    const merged = { ...byId.get(p.id), ...p };
    byId.set(p.id, merged);
    m.last.set(p.id, merged);
  }

  const idOf = (target) => (typeof target === 'string' ? target : target?.id);

  // ---- hooks ----

  function call(name, ...args) {
    if (!m || m.halted) return undefined;
    const fn = m.hooks[name];
    if (typeof fn !== 'function') return undefined;
    try {
      return fn.apply(m.hooks, args);
    } catch (err) {
      m.errors++;
      log.error?.(`${name}() threw:`, err);
      if (m.errors >= MAX_HOOK_ERRORS) crash(err);
      return undefined;
    }
  }

  const errText = (err) => (err && typeof err.message === 'string' ? err.message : String(err));

  /** The game broke: end the match with its message, and run none of its code again. */
  function crash(err) {
    if (m.halted) return;
    halt(m);
    push({ k: 'ctx', op: 'endMatch', args: [{ text: COPY.gameCrashed(errText(err)), error: true }, {}] });
  }

  function halt(match) {
    match.halted = true;
    if (match.interval !== null) tm.clearInterval(match.interval);
    match.interval = null;
  }

  // ---- output ----

  function push(item, json) {
    queue.push({ item, json });
    if (flushScheduled) return;
    flushScheduled = true;
    queueMicrotask(flush);
  }

  function deliverLocal(match, botId, type, json) {
    if (match.brains.has(botId)) deliveries.push([match, botId, type, json]);
  }

  function flush() {
    flushScheduled = false;
    const items = queue;
    const local = deliveries;
    queue = [];
    deliveries = [];
    if (items.length === 0 || stopped || !m) return;
    const msgs = items.map(({ item, json }) => (json === undefined ? item : { ...item, data: wireCopy(json) }));
    const msg = { t: C2S.RELAY, msgs };
    const tooMany = msgs.length > LIMITS.MAX_RELAY_MSGS;
    // The page (client/js/frame-host.js) makes the same check on the same array.
    const maxBytes = LIMITS.MAX_RELAY_BYTES - LIMITS.ENVELOPE_BYTES;
    if (tooMany || jsonBytes(msgs, maxBytes) > maxBytes) {
      // Sent, this would close the socket or be refused whole. End the match instead, once.
      if (!m.chatty) {
        m.chatty = true;
        if (!m.halted) halt(m);
        log.warn?.(`dropped a relay of ${msgs.length} items that was over the limit; ending the match`);
        transport.send({ t: C2S.RELAY, msgs: [{ k: 'ctx', op: 'endMatch', args: [{ text: COPY.gameTooChatty, error: true }, {}] }] });
      }
      return;
    }
    transport.send(msg);
    for (const [match, botId, type, json] of local) {
      const slot = m === match ? match.brains.get(botId) : null;
      if (!slot) continue;
      // A brain still loading gets these once it has mounted, as a socket bot would have.
      if (slot.mounted) slot.events.emit(type, wireCopy(json));
      else slot.pending?.push([type, json]);
    }
  }

  /** Validates data the way a socket would (it must survive JSON) at the moment it is sent. */
  const encode = (data) => JSON.stringify(data);

  // ---- ctx ----

  /**
   * The ctx for one match. It is bound to that match: once the match is over, every call on it
   * does nothing, and reads give empty or zero values, as a stale ctx from server/match.js does.
   */
  function makeContext(match, start) {
    const startedLocal = clock();
    const live = () => m === match && !stopped; // reads still work in onEnd
    const writable = () => live() && !match.halted;
    const resolve = (target) => {
      const id = idOf(target);
      return typeof id === 'string' && (byId.has(id) || match.known.has(id)) ? id : null;
    };

    const ctx = {
      matchId: start.matchId,
      game: { id: def.id, name: def.name },
      settings: Object.freeze({ ...(start.settings ?? {}) }),
      teams: def.teams ? def.teams.map((t) => ({ ...t })) : null,
      log,
      time: 0,
      dt: 0,
      tick: 0,
      /** The server's wall clock in ms, as of the match start plus the time run since. */
      now: () => (typeof start.startedAt === 'number' ? start.startedAt : Date.now()) + (clock() - startedLocal),

      players: () => (live() ? [...match.active].map((id) => viewFor(match, id)) : []),
      getPlayer: (id) => (live() && match.active.has(id) ? viewFor(match, id) : null),
      teamPlayers: (team) => ctx.players().filter((p) => p.team === team),
      spectators: () => (live() ? [...match.watchers].map((id) => viewFor(match, id)) : []),

      send(target, type, data) {
        const id = idOf(target);
        if (!writable() || typeof id !== 'string' || !(match.active.has(id) || match.watchers.has(id))) return;
        const json = encode(data);
        push({ k: 'out', to: 'player', id, type }, json);
        deliverLocal(match, id, type, json);
      },
      broadcast(type, data, { except } = {}) {
        if (!writable()) return;
        const skip = except ? idOf(except) ?? null : null;
        const json = encode(data);
        push(skip ? { k: 'out', to: 'all', except: skip, type } : { k: 'out', to: 'all', type }, json);
        for (const id of [...match.active, ...match.watchers]) if (id !== skip) deliverLocal(match, id, type, json);
      },
      sendTeam(team, type, data) {
        if (!writable()) return;
        const json = encode(data);
        push({ k: 'out', to: 'team', team, type }, json);
        for (const id of match.active) if (viewFor(match, id).team === team) deliverLocal(match, id, type, json);
      },

      teamScore: (team) => (live() ? match.teamScores[team] ?? 0 : 0),
      setTeamScore(team, value) {
        if (!writable() || !Object.hasOwn(match.teamScores, team)) return;
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          log.warn?.(`setTeamScore(${team}) needs a finite number; ignored`);
          return;
        }
        match.teamScores[team] = value;
        push({ k: 'ctx', op: 'setTeamScore', args: [team, value] });
      },
      addTeamScore(team, delta = 1) {
        ctx.setTeamScore(team, ctx.teamScore(team) + delta);
        return ctx.teamScore(team);
      },

      stat: (target, key) => {
        const id = live() ? resolve(target) : null;
        return id ? match.stats.get(id)?.[key] ?? 0 : 0;
      },
      setStat(target, key, value) {
        const id = writable() ? resolve(target) : null;
        if (!id) return;
        if (typeof key !== 'string' || !STAT_KEY_RE.test(key)) {
          log.warn?.(`stat key "${String(key).slice(0, 40)}" must be 1 to 32 letters, digits or underscores; ignored`);
          return;
        }
        const ok = (typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && value.length <= STAT_TEXT_MAX);
        if (!ok) {
          log.warn?.(`stat "${key}" must be a finite number or text of at most ${STAT_TEXT_MAX} characters; ignored`);
          return;
        }
        let stats = match.stats.get(id);
        if (!stats) match.stats.set(id, (stats = {}));
        if (!Object.hasOwn(stats, key) && Object.keys(stats).length >= STAT_KEYS_MAX) {
          log.warn?.(`a player holds at most ${STAT_KEYS_MAX} stats; "${key}" ignored`);
          return;
        }
        // The server cleans text stats the same way, so the runner's copy matches the scoreboard.
        const clean = typeof value === 'string' ? cleanText(value, STAT_TEXT_MAX) : value;
        stats[key] = clean;
        push({ k: 'ctx', op: 'setStat', args: [id, key, clean] });
      },
      addStat(target, key, delta = 1) {
        const id = live() ? resolve(target) : null;
        if (!id) return 0;
        ctx.setStat(id, key, (match.stats.get(id)?.[key] ?? 0) + delta);
        return ctx.stat(id, key);
      },

      /** Asks the server to move a player; the game hears it as onTeamChange once it lands. */
      setTeam(target, team) {
        const id = writable() ? resolve(target) : null;
        if (id) push({ k: 'ctx', op: 'setTeam', args: [id, team] });
      },

      announce(text) {
        if (writable()) push({ k: 'ctx', op: 'announce', args: [String(text)] });
      },

      endMatch(result = {}, opts = {}) {
        if (writable()) push({ k: 'ctx', op: 'endMatch', args: [result ?? {}, opts ?? {}] });
      },

      /** 'playing', 'results' while a results period runs, then 'ended'. */
      get phase() {
        return m === match ? match.phase : 'ended';
      },
    };
    return ctx;
  }

  // ---- bots this runner runs ----

  function botApi(match, id, options, slot) {
    return {
      get me() { return id; },
      get room() { return snapshot; },
      get settings() { return match.ctx.settings; },
      get teams() { return snapshot?.game?.teams ?? null; },
      options: { ...(options ?? {}) },
      player: (pid = id) => (m === match ? byId.get(pid) ?? null : null),
      players: () => snapshot?.players ?? [],
      team: (tid) => snapshot?.game?.teams?.find((t) => t.id === tid) ?? null,
      teamScore: (tid) => match.teamScores[tid] ?? 0,
      // What a bot sends reaches the game as if it had come over the wire: a moment later.
      send: (type, data) => {
        const json = encode(data);
        queueMicrotask(() => {
          if (m === match && match.brains.get(id) === slot && match.active.has(id)) call('onMessage', viewFor(match, id), type, wireCopy(json));
        });
      },
      on: (type, fn) => slot.events.on(type, fn),
      onRoom: (fn) => slot.events.on('$room', fn),
      serverNow: () => match.ctx.now(),
      rtt: () => 0,
      chat: () => {},
      log,
    };
  }

  /** The bot module for this match: loaded once, and a failed load is tried again next match. */
  function brainFor(match) {
    match.brainPromise ??= brainModule
      ? Promise.resolve(brainModule)
      : Promise.resolve()
        .then(() => loadBrain(def.id))
        .then((brain) => {
          if (brain && typeof brain.mount === 'function') brainModule = brain;
          return brain;
        }, (err) => {
          log.error?.('loading the bot failed:', err);
          return null;
        });
    return match.brainPromise;
  }

  /** Holds the bot's place at once, so what the game sends it on join is kept for it. */
  function addBotSlot(id) {
    const slot = { events: new Emitter(log), instance: null, mounted: false, pending: [] };
    m.brains.set(id, slot);
    return slot;
  }

  async function mountBot(id, slot, options) {
    const match = m;
    const brain = await brainFor(match);
    if (match.brains.get(id) !== slot) return;
    if (!brain || typeof brain.mount !== 'function') {
      slot.pending = null; // no brain: the bot stands still, and nothing piles up for it
      return;
    }
    try {
      const instance = (await brain.mount(botApi(match, id, options, slot))) ?? {};
      if (match.brains.get(id) !== slot) return destroyInstance(instance);
      slot.instance = instance;
      slot.mounted = true;
      const pending = slot.pending;
      slot.pending = [];
      for (const [type, json] of pending) slot.events.emit(type, wireCopy(json));
    } catch (err) {
      slot.pending = null;
      log.error?.('bot mount() failed:', err);
    }
  }

  function destroyInstance(instance) {
    try {
      instance?.destroy?.();
    } catch (err) {
      log.error?.('bot destroy() failed:', err);
    }
  }

  function unmountBot(id) {
    const slot = m.brains.get(id);
    if (!slot) return;
    m.brains.delete(id);
    destroyInstance(slot.instance);
  }

  // ---- the match lifecycle ----

  function begin(ev) {
    if (m) end();
    const match = {
      ctx: null,
      hooks: {},
      phase: 'playing',
      active: new Set(),
      watchers: new Set(),
      known: new Set(), // ids that joined and have not left
      last: new Map(), // playerId -> the last fields seen for them, kept after they leave
      views: new Map(),
      stats: new Map(),
      teamScores: Object.fromEntries((def.teams ?? []).map((t) => [t.id, 0])),
      brains: new Map(),
      brainPromise: null,
      errors: 0,
      halted: false,
      chatty: false,
      interval: null,
      lastTick: 0,
      time: 0,
      ticks: 0,
    };
    m = match;
    match.ctx = makeContext(match, ev);
    try {
      match.hooks = def.create(match.ctx) ?? {};
    } catch (err) {
      log.error?.('create() threw:', err);
      crash(err);
      return;
    }
    match.lastTick = clock();
    match.interval = tm.setInterval(tick, 1000 / def.tickRate);
  }

  function tick() {
    if (!m || m.halted) return;
    const t = clock();
    const dt = Math.min(MAX_DT, (t - m.lastTick) / 1000);
    m.lastTick = t;
    m.time += dt;
    m.ticks++;
    m.ctx.dt = dt;
    m.ctx.time = m.time;
    m.ctx.tick = m.ticks;
    call('tick', dt);
  }

  function end() {
    if (!m) return;
    halt(m);
    m.phase = 'ended';
    // onEnd is cleanup, so it runs even for a game that was halted. The server has closed the
    // match, so nothing it sends now (or still waiting in the queue) would be taken.
    const onEnd = m.hooks.onEnd;
    if (typeof onEnd === 'function') {
      try {
        onEnd.call(m.hooks);
      } catch (err) {
        log.error?.('onEnd() threw:', err);
      }
    }
    for (const id of [...m.brains.keys()]) unmountBot(id);
    m.active.clear();
    m.watchers.clear();
    m.known.clear();
    queue = [];
    deliveries = [];
    m = null;
  }

  function join(msg) {
    const { id, spectator, virtual, options } = msg;
    if (typeof id !== 'string' || m.active.has(id) || m.watchers.has(id)) return;
    applyPlayer(msg);
    m.known.add(id);
    const slot = virtual === true && !m.halted ? addBotSlot(id) : null;
    if (spectator) {
      m.watchers.add(id);
      call('onSpectatorJoin', viewFor(m, id));
    } else {
      m.active.add(id);
      call('onPlayerJoin', viewFor(m, id));
    }
    if (slot) mountBot(id, slot, options);
  }

  function leave(msg) {
    const { id } = msg;
    applyPlayer(msg);
    unmountBot(id);
    m.known.delete(id);
    if (m.watchers.delete(id)) return;
    if (!m.active.delete(id)) return;
    call('onPlayerLeave', viewFor(m, id));
  }

  function spectate(msg) {
    const { id, spectating } = msg;
    applyPlayer(msg);
    if (spectating && m.active.delete(id)) {
      call('onPlayerLeave', viewFor(m, id));
      m.watchers.add(id);
      call('onSpectatorJoin', viewFor(m, id));
    } else if (!spectating && m.watchers.delete(id)) {
      m.active.add(id);
      call('onPlayerJoin', viewFor(m, id));
    }
  }

  function dispatch(msg) {
    if (msg.t === S2C.RELAY_IN) {
      if (m && m.active.has(msg.from)) call('onMessage', viewFor(m, msg.from), msg.type, msg.data);
      return;
    }
    const ev = msg.ev;
    if (ev === 'start') return begin(msg);
    if (!m) return;
    switch (ev) {
      case 'join': return join(msg);
      case 'leave': return leave(msg);
      case 'team':
        applyPlayer(msg);
        if (m.active.has(msg.id)) call('onTeamChange', viewFor(m, msg.id), msg.oldTeam ?? null);
        return;
      case 'spectate': return spectate(msg);
      case 'results':
        m.phase = 'results';
        call('onResults', msg.result);
        return;
      case 'end': return end();
      default:
    }
  }

  function setSnapshot(room) {
    if (!room || !Array.isArray(room.players)) return;
    snapshot = room;
    byId = new Map(room.players.map((p) => [p.id, p]));
    if (!m) return;
    for (const p of room.players) m.last.set(p.id, p);
    for (const slot of m.brains.values()) slot.events.emit('$room', room);
  }

  return {
    /** Takes the server's `room`, `welcome`, `relay:event` and `relay:in` messages. */
    receive(msg) {
      if (stopped || !msg || typeof msg !== 'object') return;
      if (msg.t === S2C.ROOM || msg.t === S2C.WELCOME) return setSnapshot(msg.room);
      if (msg.t === S2C.RELAY_EVENT || msg.t === S2C.RELAY_IN) dispatch(msg);
    },
    /** Ends any running match here (onEnd, bots destroyed) and ignores everything after. */
    stop() {
      if (stopped) return;
      end();
      stopped = true;
    },
    get hooks() {
      return m?.hooks ?? {};
    },
    get ctx() {
      return m?.ctx ?? null;
    },
  };
}
