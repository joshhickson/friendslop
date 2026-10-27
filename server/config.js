import { parseArgs } from 'node:util';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBlocklist } from './blocklist.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const LOOPBACK_HOSTNAMES = ['localhost', '127.0.0.1', '::1', '[::1]'];

function int(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function list(value) {
  if (!value) return [];
  return String(value).split(',').map((s) => s.trim()).filter(Boolean);
}

export function isLoopbackHost(host) {
  return LOOPBACK_HOSTNAMES.includes(host) || /^127\./.test(host);
}

/**
 * Server configuration. Every option can be set with a CLI flag or an environment variable.
 * Defaults are deliberately locked down: the server only listens on this machine.
 */
export function loadConfig(argv = process.argv.slice(2), env = process.env) {
  const { values } = parseArgs({
    args: argv,
    strict: false,
    options: {
      port: { type: 'string', short: 'p' },
      host: { type: 'string' },
      open: { type: 'boolean' },
      tunnel: { type: 'boolean' },
    },
  });
  const tunnel = Boolean(values.tunnel) || env.TUNNEL === '1';

  const host = String(values.host ?? env.HOST ?? '127.0.0.1');
  const config = {
    host,
    port: int(values.port ?? env.PORT, 8080),
    // Open the browser on start (`npm start -- --open` or OPEN=1).
    open: Boolean(values.open) || env.OPEN === '1',

    // Extra values accepted in the HTTP Host header (e.g. a tunnel hostname later).
    // Loopback names are always accepted. Use '*' to accept any (not recommended).
    allowedHosts: list(env.ALLOWED_HOSTS),
    // Extra browser origins allowed to open a WebSocket (same-origin is always allowed).
    allowedOrigins: list(env.ALLOWED_ORIGINS),
    // Only enable behind a reverse proxy / tunnel you control, so X-Forwarded-For is trustworthy.
    trustProxy: env.TRUST_PROXY === '1',
    // Public URL through a Cloudflare quick tunnel (`npm run tunnel`). See server/tunnel.js.
    tunnel,
    // Behind cloudflared every player arrives from 127.0.0.1, so read the real client IP from
    // Cf-Connecting-Ip (set by Cloudflare's edge, which overwrites any client-supplied value).
    trustCloudflare: tunnel || env.TRUST_CLOUDFLARE === '1',

    // Folder the games are loaded from (one subfolder per game).
    gamesDir: resolve(env.GAMES_DIR ?? join(ROOT, 'games')),
    // Game preselected on the home screen and used when a create request names no game.
    // Unset means the first game found.
    defaultGame: env.DEFAULT_GAME ?? null,

    maxRooms: int(env.MAX_ROOMS, 100),
    maxPlayersPerRoom: int(env.MAX_PLAYERS_PER_ROOM, 20),
    maxConnectionsPerIp: int(env.MAX_CONNECTIONS_PER_IP, 32),
    // Players connected to the whole server at once (the server's own bots don't count).
    maxConnections: int(env.MAX_CONNECTIONS, 500),
    roomCreatesPerMinute: int(env.ROOM_CREATES_PER_MINUTE, 10),
    reconnectGraceMs: int(env.RECONNECT_GRACE_MS, 20_000),

    // Settings for a public server; both are off (0) by default.
    // Close a room when no human in it has sent anything for this long, so a forgotten tab
    // doesn't keep a match streaming all night.
    roomIdleMs: int(env.ROOM_IDLE_MS, 0),
    // Megabytes the server may send to players per day (UTC). Past it, no new rooms or
    // matches start until midnight UTC; running matches finish.
    dailyTrafficMb: int(env.DAILY_TRAFFIC_MB, 0),

    // ---- Games that run from a GitHub link (the host's browser runs them) ----
    // jsDelivr folder that serves a GitHub repo at one commit: <gameCdn><user>/<repo>@<commit>/...
    gameCdn: env.GAME_CDN ?? 'https://cdn.jsdelivr.net/gh/',
    // Where the frame loads three.js from (the same build the server vendors).
    threeBase: env.THREE_BASE ?? 'https://cdn.jsdelivr.net/npm/three@0.186.1/',
    // Where the host's browser turns a branch name into a commit.
    githubApi: env.GITHUB_API ?? 'https://api.github.com',
    // Where "Report it" sends people.
    reportUrl: env.REPORT_URL ?? 'https://github.com/joshhickson/friendslop/issues/new',
    // Serve this repo's own files at /dev-cdn/gh/... so a game can be tried before it is on GitHub.
    // Only works when the server listens on this machine.
    devCdn: env.DEV_CDN === '1' && isLoopbackHost(host),
    // Repos (lowercase user/repo) that may not be played here.
    blocklist: loadBlocklist(resolve(env.BLOCKLIST ?? join(ROOT, 'blocklist.json'))),

    logLevel: env.LOG_LEVEL ?? 'info',
  };
  config.isLoopbackOnly = isLoopbackHost(config.host);
  return config;
}

/** The settings a browser needs to load a game from GitHub, sent to every client in HELLO. */
export function remoteSettings(config) {
  return {
    cdn: config.devCdn ? '/dev-cdn/gh/' : config.gameCdn,
    three: config.devCdn ? '/vendor/three/' : config.threeBase,
    githubApi: config.githubApi,
    reportUrl: config.reportUrl,
    dev: config.devCdn,
  };
}
