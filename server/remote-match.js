// A RemoteMatch runs a game from a GitHub source. The game's code runs in the host's browser
// (the runner), never here: this side forwards player messages and lifecycle events to the
// runner, and applies the runner's sends and score changes after checking them.
//
// The runner is trusted with its own room and nothing else. Every relay item is checked, and
// an `out` item reaches exactly the players ctx.send, ctx.broadcast or ctx.sendTeam would
// reach in server/match.js.

import { randomId, TokenBucket } from './security.js';
import { STAT_KEY_RE } from './kit/defineGame.js';
import { S2C, LIMITS, cleanText } from '../shared/protocol.js';
import { COPY } from '../shared/copy.js';
import { VirtualConn } from './bots/virtual.js';

const STAT_TEXT_MAX = 64;
const TYPE_MAX = 64; // the same cap Connection puts on a player's game message type
const WINNER_MAX = 64;
const STAT_KEYS_MAX = 32; // distinct stat keys per player: every snapshot carries them all
const RELAY_DROPS_MAX = 200; // relays the runner's connection may drop in one match before it ends
// Deliveries a match may make: one per recipient of each `out` item, and one per `ctx` item.
// A 60 Hz broadcast to a full room (24 seats) is about 1440 a second. An item over it is dropped
// and counts toward RELAY_DROPS_MAX, so a game that keeps asking for more ends its match.
const DELIVERIES_PER_SECOND = 2000;
const DELIVERIES_BURST = 4000;

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * What a player event tells the runner about the player, as the server has it when the event
 * is sent. The runner's views read these, so a hook sees the new team (or connected: false)
 * without waiting for the next room snapshot.
 */
const fieldsOf = (p) => ({ id: p.id, name: p.name, team: p.team, bot: p.bot, spectating: p.spectating, connected: p.connected });

export class RemoteMatch {
  /**
   * @param {import('./room.js').Room} room
   * @param {object} def    game definition from defineRemoteGame() (create is null)
   * @param {object} settings coerced settings
   */
  constructor(room, def, settings) {
    this.room = room;
    this.def = def;
    this.settings = Object.freeze({ ...settings });
    this.id = randomId('m_');
    this.log = room.log.child(def.id);
    this.active = new Set(); // player ids that have loaded the game and are "in" the match
    this.watchers = new Set(); // loaded spectators
    this.runnerId = room.hostId; // the host at match start runs the game for everyone
    this.ended = false;
    this.runnerLost = false;
    this.relayDrops = 0;
    this.startedAt = Date.now();
    this.announceBucket = new TokenBucket(1, 5);
    // One relay message can hold 512 items for every player in the room, so the cost of a relay
    // is counted here, per delivery, not per message (Connection's relay bucket counts messages).
    this.deliveries = new TokenBucket(DELIVERIES_PER_SECOND, DELIVERIES_BURST);
  }

  start() {
    this.#event('start', { matchId: this.id, settings: this.settings, game: { id: this.def.id }, startedAt: this.startedAt });
    // Bots added in the lobby have nothing to load: they are in the match now, and the runner
    // is told to run their brains. Humans join when their own page has loaded the game.
    for (const p of this.room.players.values()) if (p.conn instanceof VirtualConn) this.room.playerLoaded(p);
  }

  stop() {
    if (this.ended) return;
    this.ended = true;
    this.#event('end', {});
    this.active.clear();
    this.watchers.clear();
  }

  /** Room calls game hooks through here; only the results period means anything to the runner. */
  call(name, ...args) {
    if (name === 'onResults' && !this.ended) this.#event('results', { result: args[0] });
    return undefined;
  }

  // ---- player lifecycle (called by Room) ----

  playerReady(player) {
    if (this.ended || this.active.has(player.id) || this.watchers.has(player.id)) return;
    (player.spectating ? this.watchers : this.active).add(player.id);
    const virtual = player.conn instanceof VirtualConn;
    this.#event('join', { id: player.id, spectator: player.spectating, virtual, options: virtual ? { difficulty: player.difficulty ?? 'normal' } : {}, player: fieldsOf(player) });
  }

  playerGone(player) {
    if (player.id === this.runnerId) this.runnerGone();
    if (!this.watchers.delete(player.id) && !this.active.delete(player.id)) return;
    this.#event('leave', { id: player.id, player: fieldsOf(player) });
  }

  /** A loaded player switched between playing and spectating mid-match. */
  playerSpectateChanged(player) {
    if (!player.loaded || this.ended) return;
    if (player.spectating && this.active.delete(player.id)) {
      this.watchers.add(player.id);
      this.#event('spectate', { id: player.id, spectating: true, player: fieldsOf(player) });
    } else if (!player.spectating && this.watchers.delete(player.id)) {
      this.active.add(player.id);
      this.#event('spectate', { id: player.id, spectating: false, player: fieldsOf(player) });
    }
  }

  playerTeamChanged(player, oldTeam) {
    if (!this.active.has(player.id)) return;
    this.#event('team', { id: player.id, oldTeam, player: fieldsOf(player) });
  }

  /** A player's game message goes to the runner, the runner's own included. */
  message(player, type, data) {
    if (this.ended || !this.active.has(player.id)) return;
    this.#runner()?.send(S2C.RELAY_IN, { from: player.id, type, data });
  }

  // ---- the runner's side ----

  /** Applies a batch from the runner. Returns an error code, or null. Bad items are skipped. */
  relay(player, msgs) {
    if (player.id !== this.runnerId) return 'not_runner';
    if (this.ended) return 'bad_phase';
    if (!Array.isArray(msgs)) return 'bad_request';
    if (msgs.length > LIMITS.MAX_RELAY_MSGS) return 'relay_too_big';
    for (const item of msgs) {
      if (!isPlain(item)) continue;
      if (item.k === 'out') this.#out(item);
      else if (item.k === 'ctx' && Array.isArray(item.args)) {
        // Ending the match is never refused: it is where a game over its budget ends up anyway.
        if (item.op !== 'endMatch' && !this.#spend(1)) continue;
        this.#ctx(item.op, item.args);
      }
    }
    return null;
  }

  #out({ to, type, data, except, team, id }) {
    if (typeof type !== 'string' || type.length > TYPE_MAX) return;
    const room = this.room;
    let targets;
    if (to === 'all') {
      if (except !== undefined && except !== null && typeof except !== 'string') return;
      targets = [...this.active, ...this.watchers].filter((pid) => pid !== except);
    } else if (to === 'team') {
      if (typeof team !== 'string') return;
      targets = [...this.active].filter((pid) => room.players.get(pid)?.team === team);
    } else if (to === 'player') {
      if (typeof id !== 'string' || !(this.active.has(id) || this.watchers.has(id))) return;
      targets = [id];
    } else {
      return;
    }
    if (targets.length === 0 || !this.#spend(targets.length)) return;
    const raw = JSON.stringify({ t: S2C.GAME, type, data }); // serialize once for everyone
    for (const pid of targets) room.players.get(pid)?.conn?.sendRaw(raw);
  }

  #ctx(op, args) {
    const room = this.room;
    switch (op) {
      case 'setStat': {
        const [pid, key, value] = args;
        const p = typeof pid === 'string' ? room.players.get(pid) : null;
        if (!p || typeof key !== 'string' || !STAT_KEY_RE.test(key)) return;
        const ok = (typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && value.length <= STAT_TEXT_MAX);
        if (!ok) return;
        if (!Object.hasOwn(p.stats, key) && Object.keys(p.stats).length >= STAT_KEYS_MAX) return;
        // Text reaches every scoreboard, so it is cleaned like a name (no control or bidi characters).
        p.stats[key] = typeof value === 'string' ? cleanText(value, STAT_TEXT_MAX) : value;
        room.markDirty();
        return;
      }
      case 'setTeamScore': {
        const [team, value] = args;
        if (typeof team !== 'string' || !Object.hasOwn(room.teamScores, team)) return;
        if (typeof value !== 'number' || !Number.isFinite(value)) return;
        room.teamScores[team] = value;
        room.markDirty();
        return;
      }
      case 'setTeam': {
        const [pid, team] = args;
        const p = typeof pid === 'string' ? room.players.get(pid) : null;
        if (!p || p.spectating || typeof team !== 'string' || !this.def.teams?.some((t) => t.id === team)) return;
        room.assignTeam(p, team);
        return;
      }
      case 'announce': {
        const text = typeof args[0] === 'string' ? cleanText(args[0], LIMITS.CHAT_MAX) : '';
        if (!text || !this.announceBucket.take()) return;
        room.systemChat(text);
        return;
      }
      case 'endMatch': {
        const [result, opts] = args;
        if ((result !== undefined && result !== null && !isPlain(result)) || (opts !== undefined && opts !== null && !isPlain(opts))) return;
        // Room.endMatch cleans text, error and resultsSeconds; only the fields it reads are passed on.
        const r = {
          winner: typeof result?.winner === 'string' && result.winner.length <= WINNER_MAX ? result.winner : undefined,
          text: result?.text,
          error: result?.error,
        };
        const o = { resultsSeconds: opts?.resultsSeconds };
        queueMicrotask(() => {
          if (!this.ended && room.match === this) room.endMatch(r, o);
        });
        return;
      }
      default:
    }
  }

  // ---- helpers ----

  /** Takes `n` deliveries from the match's budget. Refused, the item is dropped and counted. */
  #spend(n) {
    if (this.deliveries.take(n)) return true;
    this.relayDropped();
    return false;
  }

  #runner() {
    return this.room.players.get(this.runnerId)?.conn ?? null;
  }

  #event(ev, fields) {
    this.#runner()?.send(S2C.RELAY_EVENT, { ev, ...fields });
  }

  /**
   * The runner's socket closed, it left, or another connection took its seat: nobody is
   * running the game any more. Called by playerGone and by Room.attach.
   */
  runnerGone() {
    if (this.ended || this.runnerLost) return;
    this.runnerLost = true;
    this.#endSoon({ text: COPY.hostLeft, error: true });
  }

  /**
   * The runner's connection dropped a relay over its rate limit, or an item went over the match's
   * delivery budget. Too many ends the match once.
   */
  relayDropped() {
    if (this.ended || ++this.relayDrops !== RELAY_DROPS_MAX) return;
    this.log.warn(`runner dropped ${RELAY_DROPS_MAX} relays; ending the match`);
    this.#endSoon({ text: COPY.gameTooChatty, error: true });
  }

  #endSoon(result) {
    const room = this.room;
    queueMicrotask(() => {
      if (!this.ended && room.match === this) room.endMatch(result, { resultsSeconds: 0 });
    });
  }
}
