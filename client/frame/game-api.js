// The `api` a GitHub game's client module gets inside the sandboxed frame. It has every field of
// the api in client/js/screens/match.js, with the same meaning, but the frame cannot reach the
// friendslop page: what it reads comes from the snapshot the parent mirrors in (`bridge`), and
// what it does goes to the parent as a frame message (see boot.js for the protocol).
//
// No DOM and no absolute imports, so the tests can run it in Node.

class Emitter {
  constructor() {
    this.handlers = new Map();
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
        globalThis.console?.error(`handler for "${type}" failed`, err);
      }
    }
  }

  clear() {
    this.handlers.clear();
  }
}

/** A copy of `data` exactly as the wire would carry it (so nothing uncloneable reaches postMessage). */
const plain = (data) => (data === undefined ? undefined : JSON.parse(JSON.stringify(data)));

/**
 * What the frame knows of the room, and the events the game listens to. boot.js feeds it from
 * the parent's messages; createGameApi reads it.
 * @param {(kind: string, fields?: object) => void} post  sends one message to the parent
 */
export function createBridge(post) {
  const state = { me: null, room: null, serverOffset: 0, rtt: 0, blocking: false };
  const game = new Emitter(); // game message types, plus '$room'
  const ui = new Emitter(); // 'block' | 'resume'
  const matchEnd = new Set();
  const cleanups = [];
  let destroyed = false;

  const num = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

  return {
    post,
    state,
    game,
    ui,
    matchEnd,
    /** Runs `off` when the frame is torn down; returns it, so callers can also run it sooner. */
    track(off) {
      cleanups.push(off);
      return off;
    },
    get destroyed() {
      return destroyed;
    },

    init({ me, room, serverOffset, rtt } = {}) {
      state.me = typeof me === 'string' ? me : null;
      state.room = room && typeof room === 'object' ? room : null;
      state.serverOffset = num(serverOffset, 0);
      state.rtt = num(rtt, 0);
    },
    setRoom(room) {
      if (destroyed || !room || typeof room !== 'object') return;
      state.room = room;
      game.emit('$room', room);
    },
    setClock({ serverOffset, rtt } = {}) {
      state.serverOffset = num(serverOffset, state.serverOffset);
      state.rtt = num(rtt, state.rtt);
    },
    gameMessage(type, data) {
      if (!destroyed && typeof type === 'string') game.emit(type, data);
    },
    setUi({ blocking, event } = {}) {
      if (destroyed) return;
      state.blocking = Boolean(blocking);
      if (event === 'block' || event === 'resume') ui.emit(event);
    },
    /** Calls the game's onMatchEnd handlers. Returns true if it has any. */
    matchEnded(result) {
      if (destroyed) return false;
      for (const fn of [...matchEnd]) {
        try {
          fn(result);
        } catch (err) {
          globalThis.console?.error('onMatchEnd handler failed', err);
        }
      }
      return matchEnd.size > 0;
    },
    destroy() {
      destroyed = true;
      for (const off of cleanups.splice(0)) {
        try {
          off();
        } catch (err) {
          globalThis.console?.error('cleanup failed', err);
        }
      }
      game.clear();
      ui.clear();
      matchEnd.clear();
    },
  };
}

/**
 * @param {ReturnType<typeof createBridge>} bridge
 * @param {{ root: object, hud: object }} mounts  the elements the game draws into
 */
export function createGameApi(bridge, { root, hud }) {
  const { state, post } = bridge;
  const room = () => state.room;
  const myPlayer = () => state.room?.players?.find((p) => p.id === state.me) ?? null;
  const team = (id) => state.room?.game?.teams?.find((t) => t.id === id) ?? null;

  function setMatchEndHandler(fn, add) {
    const before = bridge.matchEnd.size > 0;
    if (add) bridge.matchEnd.add(fn);
    else bridge.matchEnd.delete(fn);
    const after = bridge.matchEnd.size > 0;
    // The parent shows its own toast unless the game handles the end, and it has to decide
    // without asking the frame, so the frame tells it whenever that changes.
    if (before !== after && !bridge.destroyed) post('handlesMatchEnd', { handles: after });
  }

  return {
    root,
    hud,
    get gameId() { return room()?.game?.id ?? null; },
    get me() { return state.me; },
    get room() { return room(); },
    get settings() { return room()?.match?.settings ?? room()?.settings ?? {}; },
    get teams() { return room()?.game?.teams ?? null; },
    get isHost() { return Boolean(room() && room().hostId === state.me); },
    /** True while you're watching instead of playing. React to changes with api.onRoom(). */
    get spectating() { return Boolean(myPlayer()?.spectating); },
    /** Can you switch to `teamId` right now? (false when the host turned team switching off) */
    canPickTeam: (teamId) => {
      // The same rule as canPickTeam in client/js/components.js.
      const locked = myPlayer()?.lockedTeam;
      return !locked || locked === teamId;
    },
    /** Join a team ('auto' for any), or 'spectate'. */
    pickTeam: (t) => post('pickTeam', { team: t }),
    player: (id = state.me) => room()?.players?.find((p) => p.id === id) ?? null,
    players: () => room()?.players ?? [],
    team: (id) => team(id),
    teamColor: (id) => team(id)?.color ?? '#cccccc',
    teamScore: (id) => room()?.teamScores?.[id] ?? 0,

    /** Send a message to your game's server.js (arrives in onMessage(player, type, data)). */
    send: (type, data) => post('send', { type, data: plain(data) }),
    /** Listen for messages from your server.js. Returns an unsubscribe function. */
    on(type, fn) {
      return bridge.track(bridge.game.on(type, fn));
    },
    /**
     * Called once when the match ends, with { winner, text, teamScores, stats, returnAt }.
     * Registering a handler replaces the framework's default toast. `returnAt` is the server time
     * (compare with api.serverNow()) when everyone goes back to the lobby.
     */
    onMatchEnd(fn) {
      setMatchEndHandler(fn, true);
      return bridge.track(() => setMatchEndHandler(fn, false));
    },
    /** Called whenever the room snapshot changes (players, teams, scores, stats). */
    onRoom(fn) {
      return bridge.track(bridge.game.on('$room', fn));
    },
    serverNow: () => Date.now() + state.serverOffset,
    rtt: () => state.rtt,
    toast: (text, kind = 'info', ms) => post('toast', { text: String(text), toastKind: String(kind), ...(typeof ms === 'number' ? { ms } : {}) }),

    ui: {
      /** True while chat, the pause menu, or the team picker is open. */
      isBlocking: () => state.blocking,
      on: (type, fn) => bridge.track(bridge.ui.on(type, fn)), // 'block' | 'resume'
      openMenu: () => post('ui', { action: 'openMenu' }),
      openTeamPicker: () => post('ui', { action: 'openTeamPicker' }),
      showScorebar: (show) => post('ui', { action: 'showScorebar', show: Boolean(show) }),
      showHint: (show) => post('ui', { action: 'showHint', show: Boolean(show) }),
    },
  };
}
