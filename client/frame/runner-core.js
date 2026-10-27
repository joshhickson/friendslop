// The game runner: for a room made from a GitHub source, the game's server hooks run here, in
// the host's browser, and the server only relays (server/remote-match.js). This file builds the
// same `ctx` that server/match.js gives a server-run game, drives the game's hooks from relay
// events, and sends the game's output back as relay batches.
//
// It runs unchanged in Node (the tests) and in a browser worker, so it imports only by relative
// path, uses no Node built-ins, and takes its clock and timers from the caller.

import { C2S, S2C, LIMITS } from '../../shared/protocol.js';
import { COPY } from '../../shared/copy.js';

const MAX_HOOK_ERRORS = 25; // the same limit as Match.call
const MAX_DT = 0.25; // seconds: the same cap as Match's tick
// The server's own caps on stats (server/remote-match.js). The runner keeps to them so its
// numbers and the scoreboard's never disagree.
const STAT_KEY_RE = /^[A-Za-z0-9_]{1,32}$/;
const STAT_TEXT_MAX = 64;
const STAT_KEYS_MAX = 32;
// Events that change what the room snapshot says about a player (who they are, their team,
// whether they spectate). Each one waits for the snapshot that follows it, so the game sees the
// player as the server does. The server always sends one within ~50 ms; this is the fallback.
const SNAPSHOT_WAIT_MS = 250;
const NEEDS_SNAPSHOT = new Set(['join', 'team', 'spectate']);

const SILENT = Object.freeze({ debug() {}, info() {}, warn() {}, error() {} });

/** Everything defineGame() returned except create, as plain JSON, plus hasBot. */
export function describeGame(def, { hasBot = false } = {}) {
  const { create, ...rest } = def;
  return { ...JSON.parse(JSON.stringify(rest)), hasBot: hasBot === true };
}

/** Byte length of `str` once UTF-8 encoded, skipping the encode when the answer is obvious. */
function utf8Bytes(str, limit) {
  if (str.length > limit) return str.length; // every char is at least one byte
  if (str.length * 3 <= limit) return str.length; // and at most three
  return new globalThis.TextEncoder().encode(str).length;
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

  // ---- what the server last told us about the room ----
  let snapshot = null;
  let byId = new Map(); // playerId -> the snapshot's entry

  // ---- the running match (reset by each `start`) ----
  let m = null;
  let stopped = false;
  let brainPromise = null;

  // Events and messages wait here, in order, while one of them waits for a fresh snapshot.
  const held = [];
  let waiting = false;
  let waitStart = 0;

  // ---- relay output ----
  let queue = []; // { item, json? } items for the next flush
  let deliveries = []; // [botId, type, json] for bots this runner runs
  let flushScheduled = false;

  function viewFor(id) {
    let v = m.views.get(id);
    if (v) return v;
    const entry = () => byId.get(id);
    v = Object.freeze({
      get id() { return id; },
      get name() { return entry()?.name ?? ''; },
      get team() { return entry()?.team ?? null; },
      get ping() { return entry()?.ping ?? 0; },
      get connected() { return entry()?.connected ?? m?.known.has(id) ?? false; },
      get bot() { return entry()?.bot ?? m?.known.get(id)?.virtual ?? false; },
      get spectating() {
        if (m?.active.has(id)) return false;
        if (m?.watchers.has(id)) return true;
        return entry()?.spectating ?? false;
      },
      get stats() { return { ...(m?.stats.get(id) ?? {}) }; },
    });
    m.views.set(id, v);
    return v;
  }

  const idOf = (target) => (typeof target === 'string' ? target : target?.id);
  /** A player the runner knows of, as ctx's `resolve` finds any player in the room. */
  const resolve = (target) => {
    const id = idOf(target);
    return typeof id === 'string' && (byId.has(id) || m.known.has(id)) ? id : null;
  };

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
    halt();
    push({ k: 'ctx', op: 'endMatch', args: [{ text: COPY.gameCrashed(errText(err)), error: true }, {}] });
  }

  function halt() {
    m.halted = true;
    if (m.interval !== null) tm.clearInterval(m.interval);
    m.interval = null;
  }

  // ---- output ----

  function push(item, json) {
    queue.push({ item, json });
    if (flushScheduled) return;
    flushScheduled = true;
    queueMicrotask(flush);
  }

  function deliverLocal(botId, type, json) {
    if (m.brains.has(botId)) deliveries.push([botId, type, json]);
  }

  function flush() {
    flushScheduled = false;
    const items = queue;
    const local = deliveries;
    queue = [];
    deliveries = [];
    if (items.length === 0 || stopped) return;
    const msgs = items.map(({ item, json }) => (json === undefined ? item : { ...item, data: wireCopy(json) }));
    const msg = { t: C2S.RELAY, msgs };
    const tooMany = msgs.length > LIMITS.MAX_RELAY_MSGS;
    if (tooMany || utf8Bytes(JSON.stringify(msg), LIMITS.MAX_RELAY_BYTES) > LIMITS.MAX_RELAY_BYTES) {
      // Sent, this would close the socket or be refused whole. End the match instead, once.
      if (m && !m.chatty) {
        m.chatty = true;
        if (!m.halted) halt();
        log.warn?.(`dropped a relay of ${msgs.length} items that was over the limit; ending the match`);
        transport.send({ t: C2S.RELAY, msgs: [{ k: 'ctx', op: 'endMatch', args: [{ text: COPY.gameTooChatty, error: true }, {}] }] });
      }
      return;
    }
    transport.send(msg);
    for (const [botId, type, json] of local) {
      const slot = m?.brains.get(botId);
      if (!slot) continue;
      // A brain still loading gets these once it has mounted, as a socket bot would have.
      if (slot.mounted) slot.events.emit(type, wireCopy(json));
      else slot.pending?.push([type, json]);
    }
  }

  /** Validates data the way a socket would (it must survive JSON) at the moment it is sent. */
  const encode = (data) => JSON.stringify(data);

  // ---- ctx ----

  function makeContext(start) {
    const startedLocal = clock();
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

      players: () => [...m.active].map(viewFor),
      getPlayer: (id) => (m.active.has(id) ? viewFor(id) : null),
      teamPlayers: (team) => ctx.players().filter((p) => p.team === team),
      spectators: () => [...m.watchers].map(viewFor),

      send(target, type, data) {
        const id = idOf(target);
        if (m.halted || typeof id !== 'string' || !(m.active.has(id) || m.watchers.has(id))) return;
        const json = encode(data);
        push({ k: 'out', to: 'player', id, type }, json);
        deliverLocal(id, type, json);
      },
      broadcast(type, data, { except } = {}) {
        if (m.halted) return;
        const skip = except ? idOf(except) ?? null : null;
        const json = encode(data);
        push(skip ? { k: 'out', to: 'all', except: skip, type } : { k: 'out', to: 'all', type }, json);
        for (const id of [...m.active, ...m.watchers]) if (id !== skip) deliverLocal(id, type, json);
      },
      sendTeam(team, type, data) {
        if (m.halted) return;
        const json = encode(data);
        push({ k: 'out', to: 'team', team, type }, json);
        for (const id of m.active) if (viewFor(id).team === team) deliverLocal(id, type, json);
      },

      teamScore: (team) => m.teamScores[team] ?? 0,
      setTeamScore(team, value) {
        if (!Object.hasOwn(m.teamScores, team)) return;
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          log.warn?.(`setTeamScore(${team}) needs a finite number; ignored`);
          return;
        }
        m.teamScores[team] = value;
        if (!m.halted) push({ k: 'ctx', op: 'setTeamScore', args: [team, value] });
      },
      addTeamScore(team, delta = 1) {
        ctx.setTeamScore(team, ctx.teamScore(team) + delta);
        return ctx.teamScore(team);
      },

      stat: (target, key) => {
        const id = resolve(target);
        return id ? m.stats.get(id)?.[key] ?? 0 : 0;
      },
      setStat(target, key, value) {
        const id = resolve(target);
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
        let stats = m.stats.get(id);
        if (!stats) m.stats.set(id, (stats = {}));
        if (!Object.hasOwn(stats, key) && Object.keys(stats).length >= STAT_KEYS_MAX) {
          log.warn?.(`a player holds at most ${STAT_KEYS_MAX} stats; "${key}" ignored`);
          return;
        }
        stats[key] = value;
        if (!m.halted) push({ k: 'ctx', op: 'setStat', args: [id, key, value] });
      },
      addStat(target, key, delta = 1) {
        const id = resolve(target);
        if (!id) return 0;
        ctx.setStat(id, key, (m.stats.get(id)?.[key] ?? 0) + delta);
        return ctx.stat(id, key);
      },

      /** Asks the server to move a player; the game hears it as onTeamChange once it lands. */
      setTeam(target, team) {
        const id = resolve(target);
        if (id && !m.halted) push({ k: 'ctx', op: 'setTeam', args: [id, team] });
      },

      announce(text) {
        if (!m.halted) push({ k: 'ctx', op: 'announce', args: [String(text)] });
      },

      endMatch(result = {}, opts = {}) {
        if (!m.halted) push({ k: 'ctx', op: 'endMatch', args: [result ?? {}, opts ?? {}] });
      },

      /** 'playing', 'results' while a results period runs, then 'ended'. */
      get phase() {
        return m && m.ctx === ctx ? m.phase : 'ended';
      },
    };
    return ctx;
  }

  // ---- bots this runner runs ----

  function botApi(id, options, events) {
    return {
      get me() { return id; },
      get room() { return snapshot; },
      get settings() { return m?.ctx.settings ?? snapshot?.settings ?? {}; },
      get teams() { return snapshot?.game?.teams ?? null; },
      options: { ...(options ?? {}) },
      player: (pid = id) => byId.get(pid) ?? null,
      players: () => snapshot?.players ?? [],
      team: (tid) => snapshot?.game?.teams?.find((t) => t.id === tid) ?? null,
      teamScore: (tid) => m?.teamScores[tid] ?? snapshot?.teamScores?.[tid] ?? 0,
      // What a bot sends reaches the game as if it had come over the wire: a moment later.
      send: (type, data) => {
        const json = encode(data);
        const match = m;
        queueMicrotask(() => {
          if (m === match && m.brains.get(id)?.events === events && m.active.has(id)) call('onMessage', viewFor(id), type, wireCopy(json));
        });
      },
      on: (type, fn) => events.on(type, fn),
      onRoom: (fn) => events.on('$room', fn),
      serverNow: () => m?.ctx.now() ?? Date.now(),
      rtt: () => 0,
      chat: () => {},
      log,
    };
  }

  /** Holds the bot's place at once, so what the game sends it on join is kept for it. */
  function addBotSlot(id) {
    const slot = { events: new Emitter(log), instance: null, mounted: false, pending: [] };
    m.brains.set(id, slot);
    return slot;
  }

  async function mountBot(id, slot, options) {
    const match = m;
    const { events } = slot;
    brainPromise ??= Promise.resolve().then(() => loadBrain(def.id)).catch((err) => {
      log.error?.('loading the bot failed:', err);
      return null;
    });
    const brain = await brainPromise;
    if (match.brains.get(id) !== slot) return;
    if (!brain || typeof brain.mount !== 'function') {
      slot.pending = null; // no brain: the bot stands still, and nothing piles up for it
      return;
    }
    try {
      const instance = (await brain.mount(botApi(id, options, events))) ?? {};
      if (match.brains.get(id) !== slot) return destroyInstance(instance);
      slot.instance = instance;
      slot.mounted = true;
      const pending = slot.pending;
      slot.pending = [];
      for (const [type, json] of pending) events.emit(type, wireCopy(json));
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
    m = {
      ctx: null,
      hooks: {},
      phase: 'playing',
      active: new Set(),
      watchers: new Set(),
      known: new Map(), // playerId -> { virtual } from its join, for players the snapshot has not shown yet
      views: new Map(),
      stats: new Map(),
      teamScores: Object.fromEntries((def.teams ?? []).map((t) => [t.id, 0])),
      brains: new Map(),
      errors: 0,
      halted: false,
      chatty: false,
      interval: null,
      lastTick: 0,
      time: 0,
      ticks: 0,
    };
    m.ctx = makeContext(ev);
    try {
      m.hooks = def.create(m.ctx) ?? {};
    } catch (err) {
      log.error?.('create() threw:', err);
      crash(err);
      return;
    }
    m.lastTick = clock();
    m.interval = tm.setInterval(tick, 1000 / def.tickRate);
  }

  function tick() {
    if (waiting && clock() - waitStart > SNAPSHOT_WAIT_MS) release();
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
    halt();
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
    queue = [];
    deliveries = [];
    m = null;
  }

  function join({ id, spectator, virtual, options }) {
    if (typeof id !== 'string' || m.active.has(id) || m.watchers.has(id)) return;
    m.known.set(id, { virtual: virtual === true });
    const slot = virtual === true && !m.halted ? addBotSlot(id) : null;
    if (spectator) {
      m.watchers.add(id);
      call('onSpectatorJoin', viewFor(id));
    } else {
      m.active.add(id);
      call('onPlayerJoin', viewFor(id));
    }
    if (slot) mountBot(id, slot, options);
  }

  function leave({ id }) {
    unmountBot(id);
    if (m.watchers.delete(id)) return;
    if (!m.active.delete(id)) return;
    call('onPlayerLeave', viewFor(id));
  }

  function spectate({ id, spectating }) {
    if (spectating && m.active.delete(id)) {
      call('onPlayerLeave', viewFor(id));
      m.watchers.add(id);
      call('onSpectatorJoin', viewFor(id));
    } else if (!spectating && m.watchers.delete(id)) {
      m.active.add(id);
      call('onPlayerJoin', viewFor(id));
    }
  }

  function dispatch(msg) {
    if (msg.t === S2C.RELAY_IN) {
      if (m && m.active.has(msg.from)) call('onMessage', viewFor(msg.from), msg.type, msg.data);
      return;
    }
    const ev = msg.ev;
    if (ev === 'start') return begin(msg);
    if (!m) return;
    switch (ev) {
      case 'join': return join(msg);
      case 'leave': return leave(msg);
      case 'team':
        if (m.active.has(msg.id)) call('onTeamChange', viewFor(msg.id), msg.oldTeam ?? null);
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

  function drain() {
    while (held.length && !waiting) {
      const msg = held[0];
      if (msg.t === S2C.RELAY_EVENT && NEEDS_SNAPSHOT.has(msg.ev) && m) {
        waiting = true;
        waitStart = clock();
        return;
      }
      held.shift();
      dispatch(msg);
    }
  }

  /** The snapshot the held event waited for is here (or the wait timed out): run it, then the rest. */
  function release() {
    if (!waiting) return;
    waiting = false;
    const msg = held.shift();
    if (msg) dispatch(msg);
    drain();
  }

  function setSnapshot(room) {
    if (!room || !Array.isArray(room.players)) return;
    snapshot = room;
    byId = new Map(room.players.map((p) => [p.id, p]));
    release();
    if (m) for (const slot of m.brains.values()) slot.events.emit('$room', room);
  }

  return {
    /** Takes the server's `room`, `welcome`, `relay:event` and `relay:in` messages. */
    receive(msg) {
      if (stopped || !msg || typeof msg !== 'object') return;
      if (msg.t === S2C.ROOM || msg.t === S2C.WELCOME) return setSnapshot(msg.room);
      if (msg.t !== S2C.RELAY_EVENT && msg.t !== S2C.RELAY_IN) return;
      if (waiting && clock() - waitStart > SNAPSHOT_WAIT_MS) release();
      held.push(msg);
      drain();
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
