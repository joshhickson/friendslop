// Runs lobby-added bots for every room. Each bot is a BotClient: a real WebSocket connection to
// this same server, joining through the normal join path. The only shortcut is the one-time
// ticket that stands in for the room password (the server only stores the password's hash).

import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { BotClient } from './client.js';
import { randomToken } from '../security.js';

/**
 * Secret header value the server's own bots send, so their connections skip the per-IP
 * connection cap (they all come from this machine). Random per process, never leaves it.
 */
export const INTERNAL_BOT_KEY = randomToken();

const TICKET_TTL_MS = 15_000;
const BOT_NAMES = [
  'Bolt', 'Pixel', 'Gizmo', 'Sprocket', 'Widget', 'Cog', 'Rivet', 'Dynamo', 'Servo', 'Turbo', 'Blip', 'Chip', 'Nibble', 'Byte', 'Glitch', 'Zap',
  'Gear', 'Sparky', 'Ratchet', 'Piston', 'Fuse', 'Diode', 'Volt', 'Ohm', 'Axle', 'Lug', 'Bit', 'Pico', 'Nano', 'Tesla', 'Relay', 'Crank',
];

/**
 * A bot name that no player in `room` has, and that none of the `tickets` (bots promised to the
 * room that haven't finished joining) has taken.
 */
export function pickBotName(room, tickets = new Map()) {
  const taken = new Set([...room.players.values()].map((p) => p.name.toLowerCase()));
  for (const t of tickets.values()) if (t.roomId === room.id) taken.add(t.name.toLowerCase());
  const free = BOT_NAMES.filter((n) => !taken.has(`${n} (bot)`.toLowerCase()));
  if (free.length) return `${free[Math.floor(Math.random() * free.length)]} (bot)`;
  for (let i = 2; ; i++) if (!taken.has(`bot ${i} (bot)`)) return `Bot ${i} (bot)`;
}

export class BotManager {
  constructor({ config, log, gamesDir }) {
    this.config = config;
    this.log = log;
    this.gamesDir = gamesDir;
    this.tickets = new Map(); // ticket -> { roomId, name, team, expires }
    this.bots = new Map(); // roomId -> Set<BotClient>
    this.brains = new Map(); // gameId -> Promise<module|null>
    this.port = null;
  }

  /** Called once the HTTP server is listening, so bots know where to connect. */
  setPort(port) {
    this.port = port;
  }

  hasBrain(gameId) {
    return existsSync(join(this.gamesDir, gameId, 'bot.js'));
  }

  loadBrain(gameId) {
    if (!this.brains.has(gameId)) {
      const file = join(this.gamesDir, gameId, 'bot.js');
      this.brains.set(gameId, existsSync(file)
        ? import(pathToFileURL(file).href).then((m) => m.default ?? null).catch((err) => {
          this.log.error(`failed to load bot for "${gameId}":`, err.message);
          return null;
        })
        : Promise.resolve(null));
    }
    return this.brains.get(gameId);
  }

  /** Redeem a ticket created by spawn(). One use only. */
  redeem(ticket, roomId) {
    const t = typeof ticket === 'string' ? this.tickets.get(ticket) : null;
    if (!t) return null;
    this.tickets.delete(ticket);
    if (t.roomId !== roomId || t.expires < Date.now()) return null;
    return t;
  }

  pickName(room) {
    return pickBotName(room, this.tickets);
  }

  /** Spawns one bot into `room`. Resolves once it has joined. */
  async spawn(room, { team = 'auto', difficulty = 'normal', filler = false } = {}) {
    if (!this.port) throw new Error('server is not listening yet');
    const ticket = randomToken();
    this.tickets.set(ticket, { roomId: room.id, name: this.pickName(room), team, filler, expires: Date.now() + TICKET_TTL_MS });
    const url = `ws://127.0.0.1:${this.port}/ws`;
    const bot = new BotClient({
      url,
      origin: `http://127.0.0.1:${this.port}`,
      join: { roomId: room.id, botTicket: ticket },
      loadBrain: (gameId) => this.loadBrain(gameId),
      options: { difficulty },
      log: this.log,
      headers: { 'x-internal-bot': INTERNAL_BOT_KEY },
    });
    if (!this.bots.has(room.id)) this.bots.set(room.id, new Set());
    const set = this.bots.get(room.id);
    set.add(bot);
    bot.onClose = () => {
      set.delete(bot);
      if (!set.size) this.bots.delete(room.id);
    };
    try {
      await bot.start();
    } catch (err) {
      this.tickets.delete(ticket);
      set.delete(bot);
      throw err;
    }
    return bot;
  }

  /** Bots promised to `room` (tickets issued) that haven't joined yet, per team. */
  pending(room) {
    const out = {};
    for (const t of this.tickets.values()) if (t.roomId === room.id) out[t.team] = (out[t.team] ?? 0) + 1;
    return out;
  }

  pruneTickets() {
    const now = Date.now();
    for (const [k, t] of this.tickets) if (t.expires < now) this.tickets.delete(k);
  }

  shutdown() {
    for (const set of this.bots.values()) for (const bot of set) bot.stop();
    this.bots.clear();
    this.tickets.clear();
  }
}
