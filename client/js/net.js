// WebSocket client: auto-reconnect, request helpers, ping + server clock sync.

import { C2S, S2C } from '/shared/protocol.js';

export class Emitter {
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
        console.error(`handler for "${type}" failed`, err);
      }
    }
  }
}

export class Net extends Emitter {
  constructor(url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`) {
    super();
    this.url = url;
    this.ws = null;
    this.connected = false;
    this.retry = 0;
    this.rtt = 0;
    this.clockOffset = 0; // serverTime ≈ Date.now() + clockOffset
    this.clockSamples = [];
    this.pingTimer = null;
    this.helloData = null;
  }

  connect() {
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.connected = true;
      this.retry = 0;
      this.#ping();
      clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => this.#ping(), 2000);
    };
    ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.t === S2C.PONG) return this.#pong(msg);
      if (msg.t === S2C.HELLO) {
        this.helloData = msg;
        this.clockOffset = msg.serverTime - Date.now();
        this.emit('open', msg);
        return;
      }
      if (msg.t === S2C.GAME) return this.emit('game', msg.type, msg.data);
      this.emit(msg.t, msg);
    };
    ws.onclose = () => {
      const was = this.connected;
      this.connected = false;
      clearInterval(this.pingTimer);
      if (this.ws !== ws) return;
      this.emit('close', { wasConnected: was });
      const delay = Math.min(5000, 300 * 2 ** this.retry++);
      setTimeout(() => this.connect(), delay);
    };
  }

  send(t, data = {}) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ t, ...data }));
  }

  sendGame(type, data) {
    this.send(C2S.GAME, { type, data });
  }

  /** Estimated current server time in ms. */
  serverNow() {
    return Date.now() + this.clockOffset;
  }

  #ping() {
    this.send(C2S.PING, { c: Date.now(), rtt: Math.round(this.rtt) });
  }

  #pong(msg) {
    const now = Date.now();
    const rtt = now - msg.c;
    if (rtt < 0 || rtt > 10_000) return;
    this.rtt = this.rtt ? this.rtt * 0.7 + rtt * 0.3 : rtt;
    // Keep the samples with the lowest RTT: they give the most accurate offset.
    this.clockSamples.push({ rtt, offset: msg.s + rtt / 2 - now });
    if (this.clockSamples.length > 10) this.clockSamples.shift();
    const best = [...this.clockSamples].sort((a, b) => a.rtt - b.rtt).slice(0, 3);
    this.clockOffset = best.reduce((s, x) => s + x.offset, 0) / best.length;
  }
}
