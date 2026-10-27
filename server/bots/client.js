// BotClient: a player that connects over WebSocket exactly like a browser does.
// It speaks the same protocol (shared/protocol.js), so the server can't tell it from a human
// except for the `bot` flag it sends on join (used only for the lobby badge).
//
// The bot's behaviour comes from the game's `games/<id>/bot.js`, which gets an `api` object
// that mirrors the browser game api (`api.on`, `api.send`, `api.me`, `api.player()`, ...).
// Anything outside this process can do the same thing: open a WebSocket to /ws, join with the
// room code + password, and send the same messages. See scripts/bot.js for a standalone runner.

import WebSocket from 'ws';
import { C2S, S2C } from '../../shared/protocol.js';

const EventTarget = class {
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
        this.onError?.(err, type);
      }
    }
  }
};

export class BotClient {
  /**
   * @param {object} opts
   * @param {string} opts.url        ws:// or wss:// URL of the server's /ws endpoint
   * @param {string} [opts.origin]   Origin header (the server only accepts its own origin)
   * @param {object} opts.join       the join message body: { roomId, botTicket } or { roomId, password, name, bot: true }
   * @param {(gameId: string) => Promise<object|null>} opts.loadBrain  returns the game's bot module
   * @param {object} [opts.options]  passed to the brain as api.options (e.g. { difficulty })
   * @param {object} [opts.log]
   */
  constructor({ url, origin, join, loadBrain, options = {}, log = console, headers = {} }) {
    this.url = url;
    this.origin = origin ?? url.replace(/^ws/, 'http').replace(/\/ws$/, '');
    this.headers = headers;
    this.joinMsg = join;
    this.loadBrain = loadBrain;
    this.options = options;
    this.log = log;
    this.me = null;
    this.room = null;
    this.clockOffset = 0;
    this.rtt = 0;
    this.instance = null;
    this.matchId = null;
    this.stopped = false;
    this.events = null;
  }

  /** Connects and joins. Resolves with the welcome message, rejects on a join error. */
  start() {
    return new Promise((resolve, reject) => {
      let joined = false;
      this.ws = new WebSocket(this.url, { headers: { Origin: this.origin, ...this.headers } });
      this.ws.on('open', () => {
        this.send(C2S.JOIN, this.joinMsg);
        this.pingTimer = setInterval(() => this.send(C2S.PING, { c: Date.now(), rtt: Math.round(this.rtt) }), 2000);
        this.pingTimer.unref?.();
      });
      this.ws.on('message', (raw) => {
        let msg;
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          return;
        }
        if (!joined) {
          if (msg.t === S2C.WELCOME) {
            joined = true;
            resolve(msg);
          } else if (msg.t === S2C.ERROR) {
            reject(Object.assign(new Error(msg.message), { code: msg.code }));
            this.stop();
            return;
          }
        }
        this.#onMessage(msg);
      });
      this.ws.on('close', () => {
        this.#unmount();
        clearInterval(this.pingTimer);
        if (!joined) reject(new Error('connection closed before joining'));
        this.onClose?.();
      });
      this.ws.on('error', (err) => {
        if (!joined) reject(err);
        else this.log.debug?.(`bot socket error: ${err.message}`);
      });
      this.ws.on('unexpected-response', (_req, res) => reject(new Error(`server refused the connection (HTTP ${res.statusCode})`)));
    });
  }

  send(t, data = {}) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ t, ...data }));
  }

  serverNow() {
    return Date.now() + this.clockOffset;
  }

  stop() {
    this.stopped = true;
    this.#unmount();
    clearInterval(this.pingTimer);
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
  }

  #onMessage(msg) {
    switch (msg.t) {
      case S2C.HELLO:
        this.clockOffset = msg.serverTime - Date.now();
        break;
      case S2C.PONG: {
        const rtt = Date.now() - msg.c;
        if (rtt >= 0 && rtt < 10_000) {
          this.rtt = this.rtt ? this.rtt * 0.7 + rtt * 0.3 : rtt;
          this.clockOffset = msg.s + rtt / 2 - Date.now();
        }
        break;
      }
      case S2C.WELCOME:
        this.me = msg.you;
        this.token = msg.token;
        this.#setRoom(msg.room);
        break;
      case S2C.ROOM:
        this.#setRoom(msg.room);
        break;
      case S2C.MATCH_END:
        if (this.room) this.#setRoom({ ...this.room, phase: msg.result.returnAt ? 'results' : 'lobby', match: msg.result.returnAt ? this.room.match : null });
        break;
      case S2C.LEFT:
        this.stop();
        break;
      case S2C.GAME:
        this.events?.emit(msg.type, msg.data);
        break;
      default:
        break;
    }
  }

  #setRoom(room) {
    this.room = room;
    const match = room.phase === 'playing' ? room.match : null;
    if (match && match.matchId !== this.matchId) {
      this.#unmount();
      this.#mount(match);
    } else if (!room.match) {
      this.#unmount();
    }
    this.events?.emit('$room', room);
  }

  async #mount(match) {
    this.matchId = match.matchId;
    const brain = await this.loadBrain(match.game);
    if (!brain || this.stopped || this.matchId !== match.matchId) return;
    this.events = new EventTarget();
    this.events.onError = (err, type) => this.log.error?.(`bot "${type}" handler failed:`, err);
    const api = this.#api();
    try {
      this.instance = (await brain.mount(api)) ?? {};
    } catch (err) {
      this.log.error?.('bot mount() failed:', err);
      return;
    }
    // Same handshake as the browser: "I've loaded the game, put me in".
    this.send(C2S.READY);
  }

  #unmount() {
    if (!this.instance && !this.events) return;
    try {
      this.instance?.destroy?.();
    } catch (err) {
      this.log.error?.('bot destroy() failed:', err);
    }
    this.instance = null;
    this.events = null;
    this.matchId = null;
  }

  #api() {
    const self = this;
    const events = this.events;
    return {
      get me() { return self.me; },
      get room() { return self.room; },
      get settings() { return self.room?.match?.settings ?? self.room?.settings ?? {}; },
      get teams() { return self.room?.game.teams ?? null; },
      options: { ...this.options },
      player: (id = self.me) => self.room?.players.find((p) => p.id === id) ?? null,
      players: () => self.room?.players ?? [],
      team: (id) => self.room?.game.teams?.find((t) => t.id === id) ?? null,
      teamScore: (id) => self.room?.teamScores[id] ?? 0,
      send: (type, data) => self.send(C2S.GAME, { type, data }),
      on: (type, fn) => events.on(type, fn),
      onRoom: (fn) => events.on('$room', fn),
      serverNow: () => self.serverNow(),
      rtt: () => self.rtt,
      chat: (text) => self.send(C2S.CHAT, { text }),
      log: self.log,
    };
  }
}
