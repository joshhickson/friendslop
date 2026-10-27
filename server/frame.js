// The frame page: GET /frame/?src=<game ref>&parent=<origin of the friendslop page>.
//
// A game from GitHub runs inside this page, in an <iframe> the friendslop page makes. The page is
// sandboxed by its own CSP header (so it has an opaque origin even if it is opened some other
// way), loads the game's files from the CDN pinned to one commit, and talks to the friendslop
// page only by postMessage (client/frame/boot.js).

import { randomBytes } from 'node:crypto';
import { parseRef, formatRef, refBase, repoKey } from '../shared/gameref.js';
import { COPY } from '../shared/copy.js';

/** The URL the browser used to reach this server, as an origin. */
function playOrigin(req, config) {
  const fwd = String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim().toLowerCase();
  const behindProxy = config.trustProxy || config.trustCloudflare;
  return `${behindProxy && fwd === 'https' ? 'https' : 'http'}://${req.headers.host}`;
}

/** `parent` must be a bare http(s) origin, the way the friendslop page writes location.origin. */
function validOrigin(value) {
  if (typeof value !== 'string' || value.length > 200) return false;
  try {
    const u = new URL(value);
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.origin === value;
  } catch {
    return false;
  }
}

/** JSON that is safe inside a <script> element. */
const scriptJson = (value) => JSON.stringify(value).replace(/</g, '\\u003c');

/**
 * Where the frame gets three.js. The npm package layout on a CDN, or, with the dev CDN, the
 * copies this server vendors at /vendor/three/ and /vendor/three-addons/.
 */
function threeUrls(three, play) {
  if (three.startsWith('/')) {
    return { module: `${play}/vendor/three/three.module.js`, addons: `${play}/vendor/three-addons/`, source: `${play}/vendor/` };
  }
  return { module: `${three}build/three.module.js`, addons: `${three}examples/jsm/`, source: new URL(three).origin };
}

/** A page that says why there is no game, and runs nothing. */
function refusal(status, text) {
  return {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Security-Policy': "sandbox; default-src 'none'; frame-ancestors 'self'",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'no-store',
    },
    body: text,
  };
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {object} config  server config (blocklist, trustProxy, trustCloudflare)
 * @param {{ cdn: string, three: string }} remote  remoteSettings(config): absolute, or with the dev CDN relative to this server
 * @returns {{ status: number, headers: object, body: string }}
 */
export function renderFrame(req, config, { cdn, three }) {
  const query = new URL(req.url, 'http://x').searchParams;
  const src = query.get('src');
  const ref = parseRef(src);
  const parent = query.get('parent');
  if (!ref || !validOrigin(parent)) return refusal(400, COPY.badSource);
  if (config.blocklist?.has(repoKey(ref))) return refusal(403, COPY.blocked);

  const play = playOrigin(req, config);
  const cdnBase = cdn.startsWith('/') ? `${play}${cdn}` : cdn;
  const cdnOrigin = new URL(cdnBase).origin;
  // With the dev CDN the "CDN" is this server, so allow only its /dev-cdn/ folder, not all of it.
  const cdnSource = cdn.startsWith('/') ? `${play}/${cdn.split('/')[1]}/` : cdnOrigin;
  const threeAt = threeUrls(three, play);
  const base = refBase(cdnBase, ref);
  const nonce = randomBytes(16).toString('base64');

  // Game files import the kit by absolute path (/client/kit/index.js, /shared/kit/...). Inside the
  // game's own folder at its commit, those resolve to the CDN's root, so map them back into the repo.
  const importMap = {
    imports: { three: threeAt.module, 'three/addons/': threeAt.addons },
    scopes: {
      [base]: {
        [`${cdnOrigin}/client/`]: `${base}client/`,
        [`${cdnOrigin}/shared/`]: `${base}shared/`,
      },
    },
  };
  // What boot.js needs that it cannot work out itself. A data block, so it is not a script.
  const frameConfig = { src: formatRef(ref), base, path: ref.path };

  const content = [...new Set([cdnSource, threeAt.source])].join(' ');
  const csp = [
    'sandbox allow-scripts allow-pointer-lock',
    "default-src 'none'",
    // friendslop's own frame code (boot, runner) imports /shared/protocol.js and /shared/copy.js.
    `script-src ${play}/frame/ ${play}/shared/ ${content} 'nonce-${nonce}'`,
    `style-src 'unsafe-inline' ${content}`,
    `img-src ${content} data: blob:`,
    `media-src ${content} data: blob:`,
    `font-src ${content}`,
    `connect-src ${content}`,
    // The host's runner is a blob: classic worker (see boot.js); a blob: module worker cannot start
    // from an opaque origin.
    'worker-src blob:',
    "frame-ancestors 'self'",
  ].join('; ');

  const body = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Game</title>
<style>
html, body { margin: 0; height: 100%; overflow: hidden; background: transparent; color: #e8ecf3; font: 14px system-ui, sans-serif; }
#root { position: absolute; inset: 0; }
#hud { position: absolute; inset: 0; pointer-events: none; }
#hud .interactive { pointer-events: auto; }
</style>
<script type="importmap" nonce="${nonce}">${scriptJson(importMap)}</script>
<script type="application/json" id="frame-config">${scriptJson(frameConfig)}</script>
</head>
<body>
<div id="root"></div>
<div id="hud"></div>
<script type="module" src="/frame/boot.js"></script>
</body>
</html>
`;

  return {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': csp,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      // The nonce is new for every page, so it must never be served from a cache.
      'Cache-Control': 'no-store',
    },
    body,
  };
}
