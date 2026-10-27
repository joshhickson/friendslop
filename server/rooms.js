import { Room } from './room.js';
import { hashPassword, verifyPassword, randomRoomId, FailureLimiter, WindowLimiter } from './security.js';
import { normalizeRoomId, cleanName, LIMITS } from '../shared/protocol.js';
import { parseRef, repoKey } from '../shared/gameref.js';
import { defineRemoteGame } from './kit/defineGame.js';
import { COPY } from '../shared/copy.js';

/** Owns every room on the server and handles create / join. */
export class RoomManager {
  constructor({ config, log, games, bots, traffic = null }) {
    this.config = config;
    this.log = log;
    this.games = games; // Map<id, def>
    this.bots = bots; // BotManager (lobby-added bots)
    this.traffic = traffic; // TrafficMeter (daily budget)
    this.rooms = new Map();
    // Brute-force protection: limit wrong passwords per IP and per room.
    this.ipFailures = new FailureLimiter({ maxFailures: 8, windowMs: 60_000, lockMs: 60_000 });
    this.roomFailures = new FailureLimiter({ maxFailures: 20, windowMs: 60_000, lockMs: 30_000 });
    this.createLimiter = new WindowLimiter(config.roomCreatesPerMinute, 60_000);
    this.pruneTimer = setInterval(() => {
      this.ipFailures.prune();
      this.roomFailures.prune();
      this.createLimiter.prune();
      this.bots?.pruneTickets();
    }, 60_000);
    this.pruneTimer.unref?.();
    if (config.roomIdleMs > 0) {
      this.idleTimer = setInterval(() => this.closeIdleRooms(), Math.min(60_000, Math.max(100, config.roomIdleMs / 4)));
      this.idleTimer.unref?.();
    }
  }

  /** Closes rooms where no human has sent anything for `roomIdleMs`. */
  closeIdleRooms(now = Date.now()) {
    for (const room of [...this.rooms.values()]) {
      if (now - room.lastActivity >= this.config.roomIdleMs) {
        this.log.info(`room ${room.id} closed: idle`);
        room.close('idle');
      }
    }
  }

  /**
   * The day's traffic reached the hard limit (server/traffic.js): every running match ends, the
   * ones the server runs and the ones a host's browser runs. A results period is cut short.
   */
  endMatchesOverBudget() {
    for (const room of [...this.rooms.values()]) {
      if (room.phase === 'playing') room.endMatch({ text: COPY.dataBudgetEnded, error: true }, { resultsSeconds: 0 });
      else if (room.phase === 'results') room.returnToLobby();
    }
  }

  async create(conn, msg) {
    if (!this.createLimiter.allow(conn.ip)) return { error: 'rate_limited' };
    if (this.rooms.size >= this.config.maxRooms) return { error: 'too_many_rooms' };
    if (this.traffic?.overBudget) return { error: 'traffic_budget' };
    const name = cleanName(msg.name);
    if (!name) return { error: 'bad_request', message: 'Pick a name first.' };
    // A game from a GitHub source: the host's browser described it, the server never runs it.
    // The blocklist is checked before the (untrusted) description is read.
    let def;
    if (msg.source !== undefined) {
      const ref = parseRef(msg.source);
      if (!ref) return { error: 'bad_source' };
      if (this.config.blocklist?.has(repoKey(ref))) return { error: 'game_blocked' };
      try {
        def = defineRemoteGame(msg.def, msg.source);
      } catch (err) {
        return { error: 'bad_source', message: String(err.message).slice(0, 300) };
      }
    } else {
      def = this.games.get(msg.game) ?? this.games.get(this.config.defaultGame) ?? this.games.values().next().value;
      if (!def) return { error: 'unknown_game' };
    }
    const pw = typeof msg.password === 'string' ? msg.password.slice(0, LIMITS.PASSWORD_MAX) : '';
    const password = pw ? await hashPassword(pw) : null;
    if (conn.closed || conn.room) return { error: 'already_in_room' };

    let id;
    do id = randomRoomId(); while (this.rooms.has(id));
    const room = new Room({ id, password, def, owner: this });
    this.rooms.set(id, room);
    this.log.info(`room ${id} created (${def.source ?? def.id}${password ? ', password' : ''}) by ${conn.ip}`);
    room.addPlayer(name, conn);
    return { room };
  }

  async join(conn, msg) {
    const roomId = normalizeRoomId(msg.roomId);
    if (!roomId) return { error: 'room_not_found' };
    if (this.ipFailures.isLocked(conn.ip)) return { error: 'locked_out' };
    const room = this.rooms.get(roomId);
    if (!room) {
      this.ipFailures.fail(conn.ip); // also slows down room-code scanning
      return { error: 'room_not_found' };
    }

    // Reconnect with a session token skips the password (the token proves a previous join).
    const existing = room.findByToken(msg.token);
    if (existing) {
      room.attach(existing, conn);
      room.ensureConnectedHost();
      return { room };
    }
    // A resume attempt with a stale token must never fall through to a fresh join.
    if (msg.resume) return { error: 'session_expired' };

    // A bot added by the host: the one-time ticket stands in for the password.
    if (msg.botTicket !== undefined) {
      const ticket = this.bots?.redeem(msg.botTicket, roomId);
      if (!ticket) {
        this.ipFailures.fail(conn.ip);
        return { error: 'bad_ticket' };
      }
      if (conn.closed || conn.room) return { error: 'already_in_room' };
      if (!room.hasPlayingSlot) return { error: 'room_full' };
      const p = room.addPlayer(ticket.name, conn, { bot: true, team: ticket.team });
      p.filler = Boolean(ticket.filler);
      return { room };
    }

    if (this.roomFailures.isLocked(roomId)) return { error: 'locked_out' };
    const name = cleanName(msg.name);
    if (!name) return { error: 'bad_request', message: 'Pick a name first.' };

    if (room.password) {
      const pw = typeof msg.password === 'string' ? msg.password.slice(0, LIMITS.PASSWORD_MAX) : '';
      const ok = await verifyPassword(pw, room.password);
      if (!ok) {
        this.ipFailures.fail(conn.ip);
        this.roomFailures.fail(roomId);
        return { error: 'wrong_password' };
      }
    }
    this.ipFailures.succeed(conn.ip);
    if (conn.closed || conn.room) return { error: 'already_in_room' };
    if (!this.rooms.has(roomId)) return { error: 'room_not_found' };
    // Full means every seat is taken; if only the playing slots are full, you join as a spectator.
    if (room.players.size >= room.maxSeats) return { error: 'room_full' };
    if (msg.bot === true && !room.hasPlayingSlot) return { error: 'room_full' };
    if (room.phase !== 'lobby' && !room.def.joinInProgress) return { error: 'in_progress' };

    // External bots join like anyone else (code + password) and just flag themselves.
    room.addPlayer(name, conn, { bot: msg.bot === true });
    return { room };
  }

  removeRoom(room) {
    if (this.rooms.get(room.id) === room) {
      this.rooms.delete(room.id);
      this.log.info(`room ${room.id} closed`);
    }
  }

  stats() {
    let players = 0;
    for (const r of this.rooms.values()) players += r.connectedCount;
    return { rooms: this.rooms.size, players };
  }

  shutdown() {
    clearInterval(this.pruneTimer);
    clearInterval(this.idleTimer);
    for (const room of [...this.rooms.values()]) room.destroy();
  }
}
