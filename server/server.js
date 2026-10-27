// HTTP static file server + WebSocket endpoint (/ws).

import http from 'node:http';
import { readFile, stat, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve, relative, sep, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Connection } from './connection.js';
import { RoomManager } from './rooms.js';
import { loadGames } from './games.js';
import { BotManager, INTERNAL_BOT_KEY } from './bots/manager.js';
import { createLogger } from './log.js';
import { remoteSettings } from './config.js';
import { renderFrame } from './frame.js';
import { isHostAllowed, isOriginAllowed, clientIp } from './security.js';
import { TrafficMeter } from './traffic.js';
import { LIMITS } from '../shared/protocol.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * What the dev CDN may serve, as paths relative to the repo root: the folders a game or the frame
 * imports from, and package.json. Nothing else in the repo (.git, .env, node_modules, most of server/) is reachable.
 * Compared case-insensitively, because NTFS and exFAT are.
 */
const DEV_CDN_FOLDERS = ['client/', 'shared/', 'games/', 'templates/', 'server/kit/'];

function devCdnAllowed(relPath) {
  if (relPath.includes('\\') || /[%:\u0000]/.test(relPath)) return false;
  const segments = relPath.split('/');
  if (segments.some((seg) => seg === '' || seg.startsWith('.') || /[. ]$/.test(seg))) return false;
  const lower = segments.join('/').toLowerCase();
  return lower === 'package.json' || DEV_CDN_FOLDERS.some((f) => lower.startsWith(f) && lower.length > f.length);
}

/** The same check against a path the filesystem resolved, so the filter and the disk agree. */
async function devCdnVerify(file) {
  const rel = relative(await realpath(ROOT), await realpath(file));
  return devCdnAllowed(rel.split(sep).join('/'));
}

/**
 * Public URL prefixes and the folders they map to. Only these are ever served —
 * in particular games/<id>/server.js and the server/ folder are never exposed.
 */
function mounts({ gamesDir, devCdn }) {
  return [
    // The frame runs in a sandboxed iframe with an opaque origin and imports /shared/protocol.js and
    // /shared/copy.js from here, so these routes answer cross-origin requests (see CROSS_ORIGIN_PREFIXES).
    { prefix: '/frame/', dir: join(ROOT, 'client', 'frame') },
    // Stand-in for jsDelivr when DEV_CDN=1: /dev-cdn/gh/<user>/<repo>@<commit>/<path> serves this repo's <path>,
    // whatever the user, repo and commit say. Only the folders in DEV_CDN_FOLDERS (and package.json) are served.
    ...(devCdn ? [{
      prefix: '/dev-cdn/gh/',
      dir: ROOT,
      rewrite: (rel) => {
        const m = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}@[0-9a-f]{40}\/(.+)$/.exec(rel);
        return m && devCdnAllowed(m[1]) ? m[1] : null;
      },
      verify: devCdnVerify,
    }] : []),
    { prefix: '/vendor/three/', dir: join(ROOT, 'node_modules', 'three', 'build') },
    { prefix: '/vendor/three-addons/', dir: join(ROOT, 'node_modules', 'three', 'examples', 'jsm') },
    { prefix: '/shared/', dir: join(ROOT, 'shared') },
    { prefix: '/client/', dir: join(ROOT, 'client') },
    // /games/<id>/client/... and /games/<id>/shared/... and /games/<id>/assets/...
    // ("_name" folders hold code shared between games, e.g. games/_common.)
    { prefix: '/games/', dir: gamesDir, filter: (rel) => /^_?[a-z][a-z0-9-]*\/(client|shared|assets)\//.test(rel) },
  ];
}

/** Routes whose files the sandboxed frame (opaque origin) loads, so any origin may read them. */
const CROSS_ORIGIN_PREFIXES = ['/frame/', '/dev-cdn/', '/vendor/', '/shared/'];

/** CSP hashes for the inline <script> blocks in index.html (the import map), so no other inline script can run. */
async function inlineScriptHashes() {
  const html = await readFile(join(ROOT, 'client', 'index.html'), 'utf8');
  return [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
    .map((m) => `'sha256-${createHash('sha256').update(m[1]).digest('base64')}'`);
}

let scriptHashes = [];

function securityHeaders(req, githubOrigin, pathname = '') {
  const host = req.headers.host;
  const crossOrigin = CROSS_ORIGIN_PREFIXES.some((p) => pathname.startsWith(p));
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': crossOrigin ? 'cross-origin' : 'same-origin',
    ...(crossOrigin ? { 'Access-Control-Allow-Origin': '*' } : {}),
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': [
      "default-src 'self'",
      `script-src 'self' ${scriptHashes.join(' ')}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "media-src 'self' data: blob:",
      `connect-src 'self' ws://${host} wss://${host} ${githubOrigin}`,
      "object-src 'none'",
      "base-uri 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
    ].join('; '),
  };
}

export async function createGameServer(config, { log = createLogger(config.logLevel) } = {}) {
  scriptHashes = await inlineScriptHashes();
  const games = await loadGames(config.gamesDir, log.child('games'));
  if (games.size === 0) log.warn('no games yet. Make one with: npm run new-game -- my-game');
  else log.info(`games: ${[...games.keys()].join(', ')}`);

  const bots = new BotManager({ config, log: log.child('bots'), gamesDir: config.gamesDir });
  const traffic = new TrafficMeter({ dailyMb: config.dailyTrafficMb, log: log.child('traffic') });
  const manager = new RoomManager({ config, log: log.child('rooms'), games, bots, traffic });
  const staticMounts = mounts(config);
  const remote = remoteSettings(config);
  const githubOrigin = new URL(config.githubApi).origin;

  async function serveStatic(req, res, pathname) {
    if (pathname === '/' || pathname === '/index.html') pathname = '/client/index.html';
    if (pathname === '/favicon.ico') pathname = '/client/favicon.svg';
    for (const m of staticMounts) {
      if (!pathname.startsWith(m.prefix)) continue;
      let rel = pathname.slice(m.prefix.length);
      if (m.rewrite) rel = m.rewrite(rel);
      if (rel === null || (m.filter && !m.filter(rel))) break;
      const file = resolve(m.dir, rel);
      if (!file.startsWith(m.dir + sep)) break; // path traversal
      try {
        const st = await stat(file);
        if (!st.isFile()) break;
        if (m.verify && !(await m.verify(file))) break;
        const body = await readFile(file);
        res.writeHead(200, {
          ...securityHeaders(req, githubOrigin, pathname),
          'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
          'Content-Length': body.length,
          // Vibecoding-friendly: always revalidate so edits show up on refresh.
          'Cache-Control': pathname.startsWith('/vendor/') ? 'public, max-age=86400' : 'no-cache',
        });
        if (req.method !== 'HEAD') traffic.add(body.length);
        res.end(req.method === 'HEAD' ? undefined : body);
        return;
      } catch {
        break;
      }
    }
    res.writeHead(404, { ...securityHeaders(req, githubOrigin, pathname), 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }

  const httpServer = http.createServer(async (req, res) => {
    // The health check answers under any Host name: hosting platforms probe it by internal
    // address, and it only reports counts.
    if (req.method === 'GET' && req.url === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(JSON.stringify({ ok: true, ...manager.stats(), games: [...games.keys()], traffic: traffic.stats() }));
      return;
    }
    if (!isHostAllowed(req, config)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Host not allowed');
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' });
      res.end();
      return;
    }
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    } catch {
      res.writeHead(400);
      res.end();
      return;
    }
    if (pathname.includes('\0')) {
      res.writeHead(400);
      res.end();
      return;
    }
    // The game frame's page is built per request (import map, nonce); the scripts it loads are
    // ordinary files under the /frame/ mount.
    if (pathname === '/frame/' || pathname === '/frame/index.html') {
      const page = renderFrame(req, config, remote);
      const body = Buffer.from(page.body);
      res.writeHead(page.status, { ...page.headers, 'Content-Length': body.length });
      if (req.method !== 'HEAD') traffic.add(body.length);
      res.end(req.method === 'HEAD' ? undefined : body);
      return;
    }
    await serveStatic(req, res, pathname);
  });

  // ---- WebSocket ----
  const wss = new WebSocketServer({ noServer: true, maxPayload: LIMITS.MAX_RELAY_BYTES, perMessageDeflate: false });
  const perIp = new Map();
  let players = 0; // connections other than the server's own bots
  let proxyHeadersLogged = false;

  httpServer.on('upgrade', (req, socket, head) => {
    const reject = (code, text) => {
      socket.write(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\n\r\n`);
      socket.destroy();
    };
    const { pathname } = new URL(req.url, 'http://x');
    if (pathname !== '/ws') return reject(404, 'Not Found');
    if (!isHostAllowed(req, config)) return reject(403, 'Forbidden');
    if (!isOriginAllowed(req, config)) {
      log.warn(`rejected websocket from origin ${req.headers.origin ?? '(none)'}`);
      return reject(403, 'Forbidden');
    }
    const ip = clientIp(req, config);
    const count = perIp.get(ip) ?? 0;
    // The server's own bots (lobby-added or auto-filled) are exempt; they're limited by room size instead.
    const internalBot = req.headers['x-internal-bot'] === INTERNAL_BOT_KEY && /^(127\.|::1$|::ffff:127\.)/.test(req.socket.remoteAddress ?? '');
    if (!internalBot && config.trustProxy && !proxyHeadersLogged) {
      // Once per run, record which client-IP headers the proxy sends (names and counts, never addresses).
      proxyHeadersLogged = true;
      const fwd = String(req.headers['x-forwarded-for'] ?? '');
      const others = ['forwarded', 'x-real-ip', 'true-client-ip', 'cf-connecting-ip'].filter((h) => h in req.headers);
      log.info(`proxy headers: x-forwarded-for has ${fwd ? fwd.split(',').length : 0} entries; also sent: ${others.join(', ') || 'none'}`);
    }
    if (count >= config.maxConnectionsPerIp && !internalBot) return reject(429, 'Too Many Requests');
    if (players >= config.maxConnections && !internalBot) return reject(503, 'Service Unavailable');

    wss.handleUpgrade(req, socket, head, (ws) => {
      perIp.set(ip, (perIp.get(ip) ?? 0) + 1);
      if (!internalBot) players++;
      ws.on('close', () => {
        const n = (perIp.get(ip) ?? 1) - 1;
        if (n <= 0) perIp.delete(ip);
        else perIp.set(ip, n);
        if (!internalBot) players--;
      });
      ws.isAlive = true;
      ws.on('pong', () => { ws.isAlive = true; });
      // eslint-disable-next-line no-new
      // Bot traffic stays on this machine, so only player connections count toward the budget.
      new Connection(ws, { ip, manager, log: log.child('conn'), games, defaultGame: config.defaultGame, traffic: internalBot ? null : traffic, remote });
    });
  });

  // Drop dead sockets (laptop lid closed, network gone) so their seats free up.
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, 10_000);
  heartbeat.unref?.();

  return {
    httpServer,
    wss,
    manager,
    bots,
    games,
    traffic,
    listen() {
      return new Promise((resolveListen, rejectListen) => {
        httpServer.once('error', rejectListen);
        httpServer.listen(config.port, config.host, () => {
          httpServer.off('error', rejectListen);
          bots.setPort(httpServer.address().port);
          resolveListen(httpServer.address());
        });
      });
    },
    async close() {
      clearInterval(heartbeat);
      bots.shutdown();
      manager.shutdown();
      for (const ws of wss.clients) ws.terminate();
      wss.close();
      await new Promise((r) => httpServer.close(() => r()));
    },
  };
}
