import { randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { isLoopbackHost } from './config.js';
import { ROOM_ID_ALPHABET, LIMITS } from '../shared/protocol.js';

const scryptAsync = promisify(scrypt);

// ---- Passwords --------------------------------------------------------------
// Room passwords are never stored in plain text; scrypt also makes guessing slow.

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scryptAsync(String(password), salt, 32);
  return { salt, key };
}

export async function verifyPassword(password, record) {
  const key = await scryptAsync(String(password), record.salt, 32);
  return key.length === record.key.length && timingSafeEqual(key, record.key);
}

// ---- Ids & tokens -----------------------------------------------------------

export function randomRoomId() {
  let id = '';
  for (let i = 0; i < LIMITS.ROOM_ID_LEN; i++) id += ROOM_ID_ALPHABET[randomInt(ROOM_ID_ALPHABET.length)];
  return id;
}

export const randomToken = () => randomBytes(24).toString('base64url');
export const randomId = (prefix = '') => prefix + randomBytes(6).toString('base64url');

// ---- Rate limiting ----------------------------------------------------------

/** Classic token bucket: `rate` tokens per second, holding at most `burst`. */
export class TokenBucket {
  constructor(rate, burst) {
    this.rate = rate;
    this.burst = burst;
    this.tokens = burst;
    this.last = Date.now();
  }

  take(n = 1) {
    const now = Date.now();
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.rate);
    this.last = now;
    if (this.tokens < n) return false;
    this.tokens -= n;
    return true;
  }
}

/** Counts failures per key and locks the key out for `lockMs` after `maxFailures`. */
export class FailureLimiter {
  constructor({ maxFailures = 5, windowMs = 60_000, lockMs = 60_000 } = {}) {
    this.maxFailures = maxFailures;
    this.windowMs = windowMs;
    this.lockMs = lockMs;
    this.entries = new Map();
  }

  isLocked(key) {
    const e = this.entries.get(key);
    return Boolean(e && e.lockedUntil > Date.now());
  }

  fail(key) {
    const now = Date.now();
    let e = this.entries.get(key);
    if (!e || now - e.first > this.windowMs) {
      e = { first: now, count: 0, lockedUntil: 0 };
      this.entries.set(key, e);
    }
    e.count++;
    if (e.count >= this.maxFailures) e.lockedUntil = now + this.lockMs;
  }

  succeed(key) {
    this.entries.delete(key);
  }

  prune() {
    const now = Date.now();
    for (const [key, e] of this.entries) {
      if (e.lockedUntil < now && now - e.first > this.windowMs) this.entries.delete(key);
    }
  }
}

/** Sliding counter: allow `max` events per `windowMs` per key. */
export class WindowLimiter {
  constructor(max, windowMs) {
    this.max = max;
    this.windowMs = windowMs;
    this.entries = new Map();
  }

  allow(key) {
    const now = Date.now();
    const times = (this.entries.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (times.length >= this.max) {
      this.entries.set(key, times);
      return false;
    }
    times.push(now);
    this.entries.set(key, times);
    return true;
  }

  prune() {
    const now = Date.now();
    for (const [key, times] of this.entries) {
      if (!times.some((t) => now - t < this.windowMs)) this.entries.delete(key);
    }
  }
}

// ---- Request checks ---------------------------------------------------------

function hostnameOf(hostHeader) {
  if (!hostHeader) return '';
  const h = String(hostHeader).toLowerCase();
  if (h.startsWith('[')) return h.slice(0, h.indexOf(']') + 1); // [::1]:8080
  return h.split(':')[0];
}

/**
 * Host header allowlist. Blocks DNS-rebinding attacks, where a malicious website
 * points its own domain at 127.0.0.1 to reach servers running on your machine.
 */
export function isHostAllowed(req, config) {
  if (config.allowedHosts.includes('*')) return true;
  const hostname = hostnameOf(req.headers.host);
  if (!hostname) return false;
  if (isLoopbackHost(hostname)) return true;
  return config.allowedHosts.map((h) => h.toLowerCase()).includes(hostname);
}

/**
 * WebSocket Origin check. Browsers always send Origin on WebSocket upgrades, and it
 * cannot be forged by page scripts, so this stops other websites you visit from
 * silently connecting to the game server through your browser.
 */
export function isOriginAllowed(req, config) {
  const origin = req.headers.origin;
  if (!origin) return false;
  if (config.allowedOrigins.includes(origin)) return true;
  try {
    const o = new URL(origin);
    return o.host.toLowerCase() === String(req.headers.host ?? '').toLowerCase();
  } catch {
    return false;
  }
}

export function clientIp(req, config) {
  const remote = req.socket.remoteAddress ?? 'unknown';
  // Only trust the header on connections that come from cloudflared on this machine.
  if (config.trustCloudflare && /^(127\.|::1$|::ffff:127\.)/.test(remote)) {
    const cf = req.headers['cf-connecting-ip'];
    if (typeof cf === 'string' && cf) return cf.trim();
  }
  if (config.trustProxy) {
    const fwd = req.headers['x-forwarded-for'];
    if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim();
  }
  return remote;
}
