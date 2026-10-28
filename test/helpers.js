import WebSocket from 'ws';
import { access } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createGameServer } from '../server/server.js';
import { loadConfig } from '../server/config.js';
import { createLogger } from '../server/log.js';
import { createRunner, describeGame } from '../client/frame/runner-core.js';
import { createUnpacker } from '../client/js/unpack.js';

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
  /**
   * `compress: false` connects like a client that doesn't offer WebSocket compression.
   * `packed: true` asks for packed messages and unpacks them with the browser's own code.
   */
  constructor(base, { origin = `http://${base}`, compress = true, packed = false } = {}) {
    this.base = base;
    this.origin = origin;
    this.compress = compress;
    this.packed = packed;
    this.binaryFrames = 0;
    this.messages = [];
    this.waiters = [];
    this.listeners = new Set();
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`ws://${this.base}/ws${this.packed ? '?z=1' : ''}`, { headers: { Origin: this.origin }, perMessageDeflate: this.compress });
      let unpacker = null;
      this.ws.on('message', (raw, isBinary) => {
        if (!isBinary) return this.#receive(raw.toString());
        this.binaryFrames++;
        unpacker ??= createUnpacker((text) => this.#receive(text), (err) => { throw err; });
        unpacker.push(new Uint8Array(raw));
      });
      this.ws.once('error', reject);
      this.ws.once('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
      this.ws.once('open', () => resolve(this));
    }).then(() => this.waitFor((m) => m.t === 'hello'));
  }

  #receive(text) {
    const msg = JSON.parse(text);
    this.messages.push(msg);
    for (const fn of [...this.listeners]) fn(msg);
    for (const w of [...this.waiters]) {
      if (w.pred(msg)) {
        this.waiters.splice(this.waiters.indexOf(w), 1);
        clearTimeout(w.timer);
        w.resolve(msg);
      }
    }
  }

  /** Calls `fn` with every message from now on. Returns a function that stops it. */
  onMessage(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
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

const QUIET = Object.freeze({ debug() {}, info() {}, warn() {}, error() {} });

/**
 * A host whose game runs through the real runner (client/frame/runner-core.js), as a browser
 * host's would: it loads `<gameDir>/server.js` (and `bot.js`, if there is one), makes a remote
 * room from them, and feeds the runner every room snapshot and relay message. The source is a
 * made-up pin: the server never fetches it.
 */
export async function relayHost(srv, { gameDir, password = '', log = QUIET }) {
  const def = (await import(pathToFileURL(join(gameDir, 'server.js')).href)).default;
  const botFile = join(gameDir, 'bot.js');
  const hasBot = await access(botFile).then(() => true, () => false);
  const brain = hasBot ? (await import(pathToFileURL(botFile).href)).default : null;
  const source = `gh:test/friendslop@${'0'.repeat(40)}/games/${basename(gameDir).toLowerCase()}`;

  const host = new TestClient(srv.base);
  await host.connect();
  const runner = createRunner({
    def,
    transport: { send: (msg) => { if (host.ws.readyState === WebSocket.OPEN) host.ws.send(JSON.stringify(msg)); } },
    loadBrain: async () => brain,
    log,
  });
  host.onMessage((msg) => runner.receive(msg));
  host.ws.once('close', () => runner.stop());
  host.send('room:create', { name: 'Host', password, source, def: describeGame(def, { hasBot }) });
  const welcome = await host.next((m) => m.t === 'welcome' || m.t === 'error');
  if (welcome.t === 'error') {
    host.close();
    throw new Error(`room:create refused: ${welcome.code} ${welcome.message}`);
  }
  return { host, runner, roomId: welcome.room.id, hostId: welcome.you };
}
