// One Connection per WebSocket. Parses and validates client messages and routes
// them to the room manager, the player's room, or the running game.

import { C2S, S2C, ERRORS, LIMITS, cleanText } from '../shared/protocol.js';
import { TokenBucket } from './security.js';

const OPEN = 1;

export class Connection {
  /** `socket` is the network socket under `ws`; its byte count is what the traffic meter adds up. */
  constructor(ws, { ip, manager, log, games, defaultGame, traffic = null, remote = null, socket = null }) {
    this.ws = ws;
    this.traffic = traffic;
    this.socket = socket;
    this.wireCounted = socket?.bytesWritten ?? 0;
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
    // A host-run game's runner sends a relay per tick and per reply on top of its own input,
    // so its relays have their own, larger allowance.
    this.relayBucket = new TokenBucket(480, 960);
    this.floodStrikes = 0;
    this.lastSeen = Date.now();

    ws.on('message', (data, isBinary) => this.#onMessage(data, isBinary));
    ws.on('close', () => this.#onClose());
    ws.on('error', (err) => this.log.debug('socket error:', err.message));

    this.send(S2C.HELLO, {
      serverTime: Date.now(),
      remote,
      defaultGame: games.has(defaultGame) ? defaultGame : games.keys().next().value,
      games: [...games.values()].map((g) => ({ id: g.id, name: g.name, description: g.description, minPlayers: g.minPlayers, maxPlayers: g.maxPlayers, teams: g.teams })),
    });
  }

  // ---- sending --------------------------------------------------------------

  sendRaw(raw) {
    if (this.ws.readyState !== OPEN) return;
    // If a client can't keep up, drop non-essential traffic rather than buffering forever.
    if (this.ws.bufferedAmount > 1_000_000) return;
    if (!this.traffic) return this.ws.send(raw);
    if (!this.socket) {
      // No socket to read (not reached by the server itself): string length stands in for bytes.
      this.traffic.add(raw.length);
      return this.ws.send(raw);
    }
    // Compression runs off the main thread, so the bytes are counted once the frame is written.
    this.ws.send(raw, this.#countWire);
  }

  /** Adds what the socket wrote since the last count (compressed frames, framing, pings) to the meter. */
  #countWire = () => {
    if (!this.traffic || !this.socket) return;
    const written = this.socket.bytesWritten;
    const sent = written - this.wireCounted;
    this.wireCounted = written;
    if (sent > 0) this.traffic.add(sent);
  };

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
    this.#countWire(); // the close frame and anything written since the last send
    if (this.room && this.player) this.room.disconnected(this.player);
    this.unbind();
  }

  #onMessage(data, isBinary) {
    this.lastSeen = Date.now();
    // ws already refuses anything over MAX_RELAY_BYTES (its maxPayload). Only a `relay` may pass
    // MAX_MESSAGE_BYTES, and only from a player who may relay, so nobody else gets a big message parsed.
    const big = data.length > LIMITS.MAX_MESSAGE_BYTES;
    const relayer = this.#mayRelay();
    if (isBinary || data.length > LIMITS.MAX_RELAY_BYTES || (big && !relayer)) {
      this.close(1009, 'message too large');
      return;
    }
    // Rate limits run before parsing wherever the cost is unknown. A big message (only a relayer
    // gets this far with one) pays the relay bucket by size first: 16 KB is one token.
    if (big) {
      if (!this.relayBucket.take(Math.max(1, Math.ceil(data.length / LIMITS.MAX_MESSAGE_BYTES)))) return this.#relayRefused();
    } else if (!relayer && !this.#takeShared()) {
      return;
    }
    let msg;
    try {
      msg = JSON.parse(data.toString('utf8'));
    } catch {
      if (relayer && !big && !this.#takeShared()) return;
      return this.error('bad_request');
    }
    if (big && msg?.t !== C2S.RELAY) {
      this.close(1009, 'message too large');
      return;
    }
    // A relayer's small message is parsed first, so its relays come out of their own bucket.
    if (relayer && !big) {
      if (msg?.t === C2S.RELAY) {
        if (!this.relayBucket.take()) return this.#relayRefused();
      } else if (!this.#takeShared()) {
        return;
      }
    }
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return this.error('bad_request');

    try {
      this.#route(msg);
    } catch (err) {
      this.log.error('error handling message', msg.t, err);
      this.error('bad_request', 'Server error while handling that request.');
    }
  }

  #takeShared() {
    if (this.bucket.take()) return true;
    if (++this.floodStrikes > 200) this.close(1008, 'flooding');
    return false;
  }

  /**
   * A relay over the relay bucket is dropped. From the runner of a running host-run match (playing
   * or in its results period) it counts toward the match's drop limit (too many ends the match);
   * anywhere else it is a flood strike.
   */
  #relayRefused() {
    const match = this.room?.match;
    // In the results period the match is still running (and still relaying), so it counts the same.
    const phase = this.room?.phase;
    if (match?.relayDropped && (phase === 'playing' || phase === 'results') && match.runnerId === this.player?.id) {
      match.relayDropped();
      return;
    }
    if (++this.floodStrikes > 200) this.close(1008, 'flooding');
  }

  /** The runner of the room's match, or the host of a host-run game's room (a late relay gets bad_phase). */
  #mayRelay() {
    const { room, player } = this;
    if (!room || !player || !room.def?.source) return false;
    return room.hostId === player.id || room.match?.runnerId === player.id;
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
    // Only a person's own messages keep a room open. A runner relays every tick whether or not
    // anyone is there, so relays never count.
    if (!player.bot && msg.t !== C2S.RELAY) room.lastActivity = Date.now();
    const isHost = room.hostId === player.id;
    let err = null;

    switch (msg.t) {
      case C2S.GAME:
        if (typeof msg.type === 'string' && msg.type.length <= 64) room.gameMessage(player, msg.type, msg.data);
        return;
      case C2S.RELAY:
        // Only a match of a game from a GitHub source takes relays.
        err = room.match?.relay ? room.match.relay(player, msg.msgs) : 'bad_phase';
        break;
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
        else if (msg.remove !== undefined) err = room.removeBots(msg.remove);
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
