import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseRef, formatRef, refBase, repoKey, parseGithubUrl } from '../shared/gameref.js';
import { COPY } from '../shared/copy.js';
import { ERRORS, LIMITS, utf8Bytes, jsonBytes } from '../shared/protocol.js';
import { resolveCommit } from '../client/js/github.js';
import { loadBlocklist } from '../server/blocklist.js';
import { loadConfig } from '../server/config.js';
import { KIT_VERSION } from '../server/kit/index.js';
import { startServer, TestClient } from './helpers.js';

const SHA = 'a'.repeat(40);
const ZERO = '0'.repeat(40);
const REASONS = ['not_github', 'no_game_path', 'not_found', 'rate_limited', 'network', 'timeout'];

function get(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('parseRef round-trips formatRef', () => {
  const s = `gh:josh/friendslop@${SHA}/games/tag`;
  assert.deepEqual(parseRef(s), { user: 'josh', repo: 'friendslop', commit: SHA, path: 'games/tag' });
  assert.equal(formatRef(parseRef(s)), s);
});

test('parseRef rejects bad refs', () => {
  assert.equal(parseRef(`gh:josh/friendslop@${'a'.repeat(39)}/games/tag`), null, 'short commit');
  assert.equal(parseRef(`gh:josh/friendslop@${SHA}/games/../x`), null, 'dot-dot path');
  assert.equal(parseRef(`gh:josh/re po@${SHA}/games/tag`), null, 'space in repo');
  assert.equal(parseRef(`josh/friendslop@${SHA}/games/tag`), null, 'missing gh:');
  assert.equal(parseRef(`gh:josh/..@${SHA}/games/tag`), null, 'repo named ..');
  assert.equal(parseRef(`gh:josh/friendslop@${SHA}/Games/tag`), null, 'uppercase path');
  assert.equal(parseRef(`gh:josh/friendslop@${SHA}/`), null, 'empty path');
  assert.equal(parseRef(null), null);
  assert.equal(parseRef(42), null);
});

test('parseGithubUrl handles the shapes makers paste', () => {
  const want = { user: 'a', repo: 'b', rev: 'main', path: 'games/tag' };
  assert.deepEqual(parseGithubUrl('https://github.com/a/b/tree/main/games/tag'), want);
  assert.deepEqual(parseGithubUrl('https://github.com/a/b/blob/main/games/tag'), want);
  assert.deepEqual(parseGithubUrl('https://github.com/a/b/tree/main/games/tag/'), want);
  assert.deepEqual(parseGithubUrl('https://github.com/a/b/tree/feature/x/games/tag'), { ...want, rev: 'feature/x' });
  assert.deepEqual(parseGithubUrl('https://github.com/a/b/tree/main/templates/starter'), { ...want, path: 'templates/starter' });
  assert.deepEqual(parseGithubUrl('https://github.com/a/b'), { error: 'no_game_path' });
  assert.deepEqual(parseGithubUrl('https://github.com/a/b/tree/main'), { error: 'no_game_path' });
  assert.deepEqual(parseGithubUrl('https://gitlab.com/a/b'), { error: 'not_github' });
  assert.deepEqual(parseGithubUrl('https://github.com.evil.test/a/b/tree/main/games/tag'), { error: 'not_github' });
  assert.deepEqual(parseGithubUrl('not a url'), { error: 'not_github' });
});

test('refBase builds the CDN folder', () => {
  const ref = parseRef(`gh:a/b@${SHA}/games/tag`);
  const want = `https://cdn.jsdelivr.net/gh/a/b@${SHA}/`;
  assert.equal(refBase('https://cdn.jsdelivr.net/gh/', ref), want);
  assert.equal(refBase('https://cdn.jsdelivr.net/gh/', `gh:a/b@${SHA}/games/tag`), want);
});

test('repoKey is lowercase user/repo', () => {
  assert.equal(repoKey(`gh:Josh/FriendSlop@${SHA}/games/tag`), 'josh/friendslop');
  assert.equal(repoKey({ user: 'A', repo: 'B', commit: SHA, path: 'games/x' }), 'a/b');
});

test('dev CDN serves the repo with CORS only when enabled', async () => {
  const path = `/dev-cdn/gh/x/y@${ZERO}/templates/starter/server.js`;
  const on = await startServer({ DEV_CDN: '1' });
  try {
    const res = await get(on.port, path);
    assert.equal(res.status, 200);
    assert.equal(res.headers['access-control-allow-origin'], '*');
    assert.equal(res.headers['cross-origin-resource-policy'], 'cross-origin');
    const dev = (p) => get(on.port, `/dev-cdn/gh/x/y@${ZERO}/${p}`);
    // The allowlist: a few folders and package.json.
    assert.equal((await dev('package.json')).status, 200);
    assert.equal((await dev('server/kit/index.js')).status, 200);
    assert.equal((await dev('shared/protocol.js')).status, 200);
    // Everything else is a 404, including the ways Windows can reach it.
    const blocked = {
      'dot folder': '.git/config',
      'dot file that exists': '.gitignore',
      'a .env request': '.env',
      node_modules: 'node_modules/ws/package.json',
      'node_modules, other case': 'Node_Modules/ws/package.json',
      'node_modules behind %5C': 'node_modules%5Cws%5Cpackage.json',
      'git HEAD behind %5C and ..': 'x%5C..%5C.git%5CHEAD',
      'git config behind %5C and ..': 'x%5C..%5C.git%5Cconfig',
      'server/ outside server/kit': 'server/rooms.js',
      'server/ in other case': 'SERVER/rooms.js',
      'the folder itself': 'server/kit/',
      'double-encoded percent': '%252e%252e/package.json',
      'traversal': '%2e%2e/package.json',
      'traversal inside an allowed folder': 'shared/../server/rooms.js',
      'a stream suffix': 'package.json::$DATA',
      'a trailing dot': 'server.js.',
      'docs': 'docs/superpowers/specs/2026-10-26-game-hosting-design.md',
    };
    for (const [what, p] of Object.entries(blocked)) assert.equal((await dev(p)).status, 404, what);
    assert.equal((await get(on.port, '/dev-cdn/gh/x/y@short/package.json')).status, 404, 'needs a full commit');
  } finally {
    await on.close();
  }
  const off = await startServer();
  try {
    assert.equal((await get(off.port, path)).status, 404);
  } finally {
    await off.close();
  }
});

test('DEV_CDN only turns on for a loopback host', () => {
  assert.equal(loadConfig([], { DEV_CDN: '1' }).devCdn, true);
  assert.equal(loadConfig([], { DEV_CDN: '1', HOST: '0.0.0.0' }).devCdn, false);
  assert.equal(loadConfig([], { HOST: '127.0.0.1' }).devCdn, false);
});

test('config carries the hosting defaults', () => {
  const c = loadConfig([], {});
  assert.equal(c.gameCdn, 'https://cdn.jsdelivr.net/gh/');
  assert.equal(c.threeBase, 'https://cdn.jsdelivr.net/npm/three@0.186.1/');
  assert.equal(c.githubApi, 'https://api.github.com');
  assert.equal(c.reportUrl, 'https://github.com/joshhickson/friendslop/issues/new');
  assert.ok(c.blocklist instanceof Set);
});

test('frame-facing routes allow cross-origin loads; the rest stay same-origin', async () => {
  const srv = await startServer();
  try {
    for (const path of ['/shared/protocol.js', '/shared/copy.js', '/vendor/three/three.module.js']) {
      const res = await get(srv.port, path);
      assert.equal(res.status, 200, path);
      assert.equal(res.headers['access-control-allow-origin'], '*', path);
      assert.equal(res.headers['cross-origin-resource-policy'], 'cross-origin', path);
    }
    const own = await get(srv.port, '/client/js/app.js');
    assert.equal(own.headers['cross-origin-resource-policy'], 'same-origin');
    assert.equal(own.headers['access-control-allow-origin'], undefined);
    assert.match(own.headers['content-security-policy'], /connect-src [^;]*https:\/\/api\.github\.com/);
    const missing = await get(srv.port, '/frame/nothing.js');
    assert.equal(missing.status, 404, 'a missing frame file is a 404');
  } finally {
    await srv.close();
  }
});

test('hello carries the remote settings', async () => {
  const srv = await startServer();
  const c = new TestClient(srv.base);
  try {
    await c.connect();
    const { remote } = c.messages[0];
    assert.equal(remote.reportUrl, 'https://github.com/joshhickson/friendslop/issues/new');
    assert.equal(remote.dev, false);
    assert.equal(remote.cdn, 'https://cdn.jsdelivr.net/gh/');
    assert.equal(remote.three, 'https://cdn.jsdelivr.net/npm/three@0.186.1/');
    assert.equal(remote.githubApi, 'https://api.github.com');
  } finally {
    c.close();
    await srv.close();
  }
  const dev = await startServer({ DEV_CDN: '1' });
  const d = new TestClient(dev.base);
  try {
    await d.connect();
    assert.equal(d.messages[0].remote.cdn, '/dev-cdn/gh/');
    assert.equal(d.messages[0].remote.three, '/vendor/three/');
    assert.equal(d.messages[0].remote.dev, true);
  } finally {
    d.close();
    await dev.close();
  }
});

test('the blocklist loads repo keys lowercased', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'blocklist-'));
  try {
    const file = join(dir, 'blocklist.json');
    await writeFile(file, '{"repos":["A/B"]}');
    const set = loadBlocklist(file);
    assert.ok(set instanceof Set);
    assert.ok(set.has('a/b'));
    assert.equal(loadBlocklist(join(dir, 'missing.json')).size, 0, 'a missing file blocks nothing');
    await writeFile(file, '{oops');
    assert.throws(() => loadBlocklist(file), /blocklist/i, 'a broken file is loud, not silently empty');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('player-facing copy has no em or en dashes and its functions say what happened', () => {
  const all = [];
  for (const [key, v] of Object.entries(COPY)) {
    if (typeof v === 'string') all.push(v);
    else {
      assert.equal(typeof v, 'function', key);
      if (key === 'badLink') all.push(...REASONS.map((r) => v(r)), v('something_else'));
      else if (key === 'gameCrashed' || key === 'gameWontLoad') all.push(v('boom at line 3'));
      else if (key === 'unreviewedBanner') all.push(v('josh', 'josh/tag'));
      else assert.fail(`unexpected function ${key}`);
    }
  }
  for (const s of all) {
    assert.ok(s.length > 10);
    assert.doesNotMatch(s, /[–—]/);
  }
  const reasons = REASONS.map((r) => COPY.badLink(r));
  assert.equal(new Set(reasons).size, reasons.length, 'each reason has its own sentence');
  assert.ok(COPY.gameCrashed('boom at line 3').includes('boom at line 3'));
  assert.ok(COPY.gameWontLoad('boom at line 3').includes('boom at line 3'));
  assert.ok(COPY.unreviewedBanner('josh', 'josh/tag').includes('josh'));
  assert.ok(COPY.unreviewedBanner('josh', 'josh/tag').includes('josh/tag'));
});

test('errors take their text from the copy', () => {
  assert.equal(ERRORS.traffic_budget, COPY.dataBudget);
  assert.equal(ERRORS.game_blocked, COPY.blocked);
  for (const code of ['bad_source', 'not_runner', 'relay_too_big']) assert.ok(ERRORS[code]?.length > 10, code);
});

test('sizes are measured in UTF-8 bytes, as the server counts them', () => {
  assert.equal(utf8Bytes('abc'), 3);
  assert.equal(utf8Bytes('é'), 2);
  assert.equal(utf8Bytes('€'), 3);
  assert.equal(jsonBytes({ s: 'é' }), Buffer.byteLength(JSON.stringify({ s: 'é' })));
  assert.equal(jsonBytes(undefined), 0);
  assert.equal(jsonBytes({ n: 1n }), Infinity);
  // With a limit, the answer is only exact about which side of it the bytes fall on.
  const wide = 'é'.repeat(9000); // 9000 characters, 18,000 bytes
  const max = LIMITS.MAX_MESSAGE_BYTES - LIMITS.ENVELOPE_BYTES;
  assert.ok(wide.length < max && jsonBytes(wide, max) > max);
  assert.ok(jsonBytes('x'.repeat(100), max) <= max);
});

test('the kit has a version', () => {
  assert.equal(KIT_VERSION, 1);
});

// ---- the host form's commit resolver, with a stubbed fetch ----

const API = 'https://api.github.com';
const stubFetch = (reply) => {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    if (reply instanceof Error) throw reply;
    return { ok: reply.status >= 200 && reply.status < 300, status: reply.status, text: async () => reply.body ?? '' };
  };
  fn.calls = calls;
  return fn;
};

test('resolveCommit returns a pasted commit without asking GitHub', async () => {
  const fetch = stubFetch({ status: 500 });
  assert.deepEqual(await resolveCommit({ user: 'a', repo: 'b', rev: SHA }, { api: API, fetch }), { commit: SHA });
  assert.equal(fetch.calls.length, 0);
});

test('resolveCommit reads the commit for a branch', async () => {
  const fetch = stubFetch({ status: 200, body: `${SHA}
` });
  assert.deepEqual(await resolveCommit({ user: 'a', repo: 'b', rev: 'feature/x' }, { api: API, fetch }), { commit: SHA });
  assert.equal(fetch.calls.length, 1);
  assert.ok(fetch.calls[0].url.startsWith(`${API}/repos/a/b/commits/`));
  assert.ok(fetch.calls[0].url.endsWith('/commits/feature%2Fx'));
  assert.equal(fetch.calls[0].init.headers.Accept, 'application/vnd.github.sha');
});

test('resolveCommit explains failures', async () => {
  const ask = (reply) => resolveCommit({ user: 'a', repo: 'b', rev: 'main' }, { api: API, fetch: stubFetch(reply) });
  assert.deepEqual(await ask({ status: 404 }), { error: 'not_found' });
  assert.deepEqual(await ask({ status: 422 }), { error: 'not_found' });
  assert.deepEqual(await ask({ status: 403 }), { error: 'rate_limited' });
  assert.deepEqual(await ask({ status: 429 }), { error: 'rate_limited' });
  assert.deepEqual(await ask(new TypeError('Failed to fetch')), { error: 'network' });
  assert.deepEqual(await ask({ status: 502 }), { error: 'network' });
  assert.deepEqual(await ask({ status: 200, body: '<html>captive portal</html>' }), { error: 'network' }, 'a body that is not a commit');
});
