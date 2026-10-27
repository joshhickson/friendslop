import WebSocket from 'ws';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGameServer } from '../server/server.js';
import { loadConfig } from '../server/config.js';
import { createLogger } from '../server/log.js';

/** Test-only games: `dots` (two teams, has a bot) and `solo` (no teams, no bot). */
export const FIXTURE_GAMES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'games');

export async function startServer(env = {}) {
  const config = loadConfig([], { PORT: '0', LOG_LEVEL: 'silent', RECONNECT_GRACE_MS: '300', ROOM_CREATES_PER_MINUTE: '1000', GAMES_DIR: FIXTURE_GAMES, ...env });
  const server = await createGameServer(config, { log: createLogger('silent') });
  const addr = await server.listen();
  const base = `127.0.0.1:${addr.port}`;
  return { server, base, port: addr.port, close: () => server.close() };
}

/** A scripted test client that records every message it receives. */
export class TestClient {
  constructor(base, { origin = `http://${base}` } = {}) {
    this.base = base;
    this.origin = origin;
    this.messages = [];
    this.waiters = [];
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`ws://${this.base}/ws`, { headers: { Origin: this.origin } });
      this.ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        this.messages.push(msg);
        for (const w of [...this.waiters]) {
          if (w.pred(msg)) {
            this.waiters.splice(this.waiters.indexOf(w), 1);
            clearTimeout(w.timer);
            w.resolve(msg);
          }
        }
      });
      this.ws.once('error', reject);
      this.ws.once('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
      this.ws.once('open', () => resolve(this));
    }).then(() => this.waitFor((m) => m.t === 'hello'));
  }

  send(t, data = {}) {
    this.ws.send(JSON.stringify({ t, ...data }));
  }

  game(type, data) {
    this.send('game', { type, data });
  }

  /** Resolves with the first message (already received or future) matching `pred`. */
  waitFor(pred, ms = 2000, { fromIndex = 0 } = {}) {
    const existing = this.messages.slice(fromIndex).find(pred);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const w = { pred, resolve };
      w.timer = setTimeout(() => {
        this.waiters.splice(this.waiters.indexOf(w), 1);
        reject(new Error(`timed out waiting for message (${pred})`));
      }, ms);
      this.waiters.push(w);
    });
  }

  /** Waits only for messages that arrive after this call. */
  next(pred, ms) {
    return this.waitFor(pred, ms, { fromIndex: this.messages.length });
  }

  nextGame(type, ms) {
    return this.next((m) => m.t === 'game' && m.type === type, ms).then((m) => m.data);
  }

  roomWhere(pred, ms) {
    return this.waitFor((m) => (m.t === 'room' || m.t === 'welcome') && pred(m.room), ms, { fromIndex: 0 }).then((m) => m.room);
  }

  nextRoomWhere(pred, ms) {
    return this.next((m) => (m.t === 'room' || m.t === 'welcome') && pred(m.room), ms).then((m) => m.room);
  }

  close() {
    this.ws?.close();
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
