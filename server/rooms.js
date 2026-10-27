import { Room } from './room.js';
import { hashPassword, verifyPassword, randomRoomId, FailureLimiter, WindowLimiter } from './security.js';
import { normalizeRoomId, cleanName, LIMITS } from '../shared/protocol.js';

/** Owns every room on the server and handles create / join. */
export class RoomManager {
  constructor({ config, log, games, bots }) {
    this.config = config;
    this.log = log;
    this.games = games; // Map<id, def>
    this.bots = bots; // BotManager (lobby-added bots)
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
  }

  async create(conn, msg) {
    if (!this.createLimiter.allow(conn.ip)) return { error: 'rate_limited' };
    if (this.rooms.size >= this.config.maxRooms) return { error: 'too_many_rooms' };
    const name = cleanName(msg.name);
    if (!name) return { error: 'bad_request', message: 'Pick a name first.' };
    const def = this.games.get(msg.game) ?? this.games.get(this.config.defaultGame) ?? this.games.values().next().value;
    if (!def) return { error: 'unknown_game' };
    const pw = typeof msg.password === 'string' ? msg.password.slice(0, LIMITS.PASSWORD_MAX) : '';
    const password = pw ? await hashPassword(pw) : null;
    if (conn.closed || conn.room) return { error: 'already_in_room' };

    let id;
    do id = randomRoomId(); while (this.rooms.has(id));
    const room = new Room({ id, password, def, owner: this });
    this.rooms.set(id, room);
    this.log.info(`room ${id} created (${def.id}${password ? ', password' : ''}) by ${conn.ip}`);
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
    for (const room of [...this.rooms.values()]) room.destroy();
  }
}
