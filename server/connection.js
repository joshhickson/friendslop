// One Connection per WebSocket. Parses and validates client messages and routes
// them to the room manager, the player's room, or the running game.

import { C2S, S2C, ERRORS, LIMITS, cleanText } from '../shared/protocol.js';
import { TokenBucket } from './security.js';

const OPEN = 1;

export class Connection {
  constructor(ws, { ip, manager, log, games, defaultGame, traffic = null }) {
    this.ws = ws;
    this.traffic = traffic;
    this.ip = ip;
    this.manager = manager;
    this.log = log;
    this.games = games;
    this.room = null;
    this.player = null;
    this.closed = false;
    this.busy = false; // an async create/join is in flight
    // Generous enough for 60 Hz input plus extras; floods get dropped then disconnected.
    this.bucket = new TokenBucket(120, 240);
    this.chatBucket = new TokenBucket(1, 5);
    this.floodStrikes = 0;
    this.lastSeen = Date.now();

    ws.on('message', (data, isBinary) => this.#onMessage(data, isBinary));
    ws.on('close', () => this.#onClose());
    ws.on('error', (err) => this.log.debug('socket error:', err.message));

    this.send(S2C.HELLO, {
      serverTime: Date.now(),
      defaultGame: games.has(defaultGame) ? defaultGame : games.keys().next().value,
      games: [...games.values()].map((g) => ({ id: g.id, name: g.name, description: g.description, minPlayers: g.minPlayers, maxPlayers: g.maxPlayers, teams: g.teams })),
    });
  }

  // ---- sending --------------------------------------------------------------

  sendRaw(raw) {
    if (this.ws.readyState !== OPEN) return;
    // If a client can't keep up, drop non-essential traffic rather than buffering forever.
    if (this.ws.bufferedAmount > 1_000_000) return;
    // String length stands in for bytes: the protocol is JSON and almost all ASCII.
    this.traffic?.add(raw.length);
    this.ws.send(raw);
  }

  send(type, data = {}) {
    this.sendRaw(JSON.stringify({ t: type, ...data }));
  }

  sendGame(type, data) {
    this.sendRaw(JSON.stringify({ t: S2C.GAME, type, data }));
  }

  error(code, message) {
    this.send(S2C.ERROR, { code, message: message ?? ERRORS[code] ?? code });
  }

  // ---- room binding (called by Room) ----------------------------------------

  bind(room, player) {
    this.room = room;
    this.player = player;
  }

  unbind() {
    this.room = null;
    this.player = null;
  }

  /** Another connection took over this player's seat (e.g. a second tab used the same token). */
  detach(reason) {
    this.unbind();
    this.send(S2C.LEFT, { reason });
  }

  close(code = 1000, reason = '') {
    try { this.ws.close(code, reason); } catch { /* ignore */ }
  }

  // ---- receiving ------------------------------------------------------------

  #onClose() {
    this.closed = true;
    if (this.room && this.player) this.room.disconnected(this.player);
    this.unbind();
  }

  #onMessage(data, isBinary) {
    this.lastSeen = Date.now();
    if (isBinary || data.length > LIMITS.MAX_MESSAGE_BYTES) {
      this.close(1009, 'message too large');
      return;
    }
    if (!this.bucket.take()) {
      if (++this.floodStrikes > 200) this.close(1008, 'flooding');
      return;
    }
    let msg;
    try {
      msg = JSON.parse(data.toString('utf8'));
    } catch {
      return this.error('bad_request');
    }
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return this.error('bad_request');

    try {
      this.#route(msg);
    } catch (err) {
      this.log.error('error handling message', msg.t, err);
      this.error('bad_request', 'Server error while handling that request.');
    }
  }

  #route(msg) {
    const { room, player } = this;
    switch (msg.t) {
      case C2S.PING:
        if (player && typeof msg.rtt === 'number' && Number.isFinite(msg.rtt)) player.ping = Math.max(0, Math.min(9999, Math.round(msg.rtt)));
        this.send(S2C.PONG, { c: msg.c, s: Date.now() });
        return;

      case C2S.CREATE:
      case C2S.JOIN:
        if (room) return this.error('already_in_room');
        if (this.busy) return;
        this.busy = true;
        (msg.t === C2S.CREATE ? this.manager.create(this, msg) : this.manager.join(this, msg))
          .then((res) => { if (res.error) this.error(res.error, res.message); })
          .catch((err) => {
            this.log.error('join/create failed', err);
            this.error('bad_request', 'Server error.');
          })
          .finally(() => { this.busy = false; });
        return;
    }

    if (!room || !player) return this.error('not_in_room');
    if (!player.bot) room.lastActivity = Date.now();
    const isHost = room.hostId === player.id;
    let err = null;

    switch (msg.t) {
      case C2S.GAME:
        if (typeof msg.type === 'string' && msg.type.length <= 64) room.gameMessage(player, msg.type, msg.data);
        return;
      case C2S.LEAVE:
        room.removePlayer(player, 'left');
        return;
      case C2S.TEAM:
        err = room.pickTeam(player, msg.team);
        break;
      case C2S.READY:
        room.playerLoaded(player);
        return;
      case C2S.CHAT: {
        const text = cleanText(msg.text, LIMITS.CHAT_MAX);
        if (!text) return;
        if (!this.chatBucket.take()) return this.error('rate_limited');
        room.chatFrom(player, text);
        return;
      }
      case C2S.CONFIG:
        err = isHost ? room.configure({ game: msg.game, settings: msg.settings, options: msg.options }) : 'not_host';
        break;
      case C2S.START:
        err = isHost ? room.startMatch() : 'not_host';
        break;
      case C2S.END:
        if (!isHost) err = 'not_host';
        else if (room.phase === 'results') room.returnToLobby();
        else if (room.phase !== 'playing') err = 'bad_phase';
        else room.endMatch({ text: `${player.name} (host) ended the match.` }, { resultsSeconds: 0 });
        break;
      case C2S.BOTS:
        if (!isHost) err = 'not_host';
        else if (msg.remove !== undefined) room.removeBots(msg.remove);
        else err = room.addBots({ count: msg.add, team: msg.team, difficulty: msg.difficulty });
        break;
      case C2S.KICK: {
        if (!isHost) { err = 'not_host'; break; }
        const target = room.players.get(msg.playerId);
        if (target && target !== player) room.removePlayer(target, 'kicked');
        return;
      }
      default:
        err = 'bad_request';
    }
    if (err) this.error(err);
  }
}
