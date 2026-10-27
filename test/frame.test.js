import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { refBase } from '../shared/gameref.js';
import { COPY } from '../shared/copy.js';
import { createBridge, createGameApi } from '../client/frame/game-api.js';
import { startServer } from './helpers.js';

const SHA = 'b'.repeat(40);
const REF = `gh:maker/fun-games@${SHA}/games/tag`;
const CDN = 'https://cdn.jsdelivr.net/gh/';
const THREE = 'https://cdn.jsdelivr.net/npm/three@0.186.1/';

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

const framePath = (port, src = REF, parent = `http://127.0.0.1:${port}`) =>
  `/frame/?src=${encodeURIComponent(src)}&parent=${encodeURIComponent(parent)}`;

function importMap(body) {
  const m = /<script type="importmap" nonce="([^"]+)">([\s\S]*?)<\/script>/.exec(body);
  assert.ok(m, 'the page has a nonced import map');
  return { nonce: m[1], map: JSON.parse(m[2]) };
}

/** The CSP as { directive: [values] }, in order. */
function csp(header) {
  return Object.fromEntries(header.split(';').map((d) => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));
}

test("the frame page pins the game's commit in its import map", async () => {
  const srv = await startServer();
  try {
    const res = await get(srv.port, framePath(srv.port));
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /^text\/html/);
    const { map } = importMap(res.body);
    const base = refBase(CDN, REF);
    assert.ok(Object.hasOwn(map.scopes, base), 'scoped to the pinned commit');
    assert.equal(map.scopes[base]['https://cdn.jsdelivr.net/client/'], `${base}client/`);
    assert.equal(map.scopes[base]['https://cdn.jsdelivr.net/shared/'], `${base}shared/`);
    assert.equal(map.imports.three, `${THREE}build/three.module.js`);
    assert.equal(map.imports['three/addons/'], `${THREE}examples/jsm/`);
    assert.match(res.body, /<script type="module" src="\/frame\/boot\.js"><\/script>/);
    assert.match(res.body, /id="root"/);
    assert.match(res.body, /id="hud"/);
    // The same page answers at /frame/index.html.
    const again = await get(srv.port, framePath(srv.port).replace('/frame/?', '/frame/index.html?'));
    assert.equal(again.status, 200);
    assert.ok(Object.hasOwn(importMap(again.body).map.scopes, base));
  } finally {
    await srv.close();
  }
});

test('the frame page is sandboxed by header', async () => {
  const srv = await startServer();
  try {
    const res = await get(srv.port, framePath(srv.port));
    const header = res.headers['content-security-policy'];
    assert.ok(header.startsWith('sandbox allow-scripts allow-pointer-lock;'), header);
    const { nonce } = importMap(res.body);
    const d = csp(header);
    assert.ok(d['script-src'].includes(`'nonce-${nonce}'`), 'the nonce in the body is the one the CSP allows');
    const play = `http://127.0.0.1:${srv.port}`;
    assert.ok(d['script-src'].includes(`${play}/frame/`));
    assert.ok(d['script-src'].includes(`${play}/shared/`));
    assert.ok(d['script-src'].includes('https://cdn.jsdelivr.net'));
    assert.deepEqual(d['default-src'], ["'none'"]);
    assert.deepEqual(d['worker-src'], ['blob:']);
    assert.deepEqual(d['frame-ancestors'], ["'self'"]);
    assert.ok(!d['script-src'].includes("'unsafe-inline'") && !d['script-src'].includes("'unsafe-eval'"));
    assert.equal(res.headers['x-frame-options'], undefined);
    assert.equal(res.headers['cache-control'], 'no-store');
    // A fresh nonce for every page.
    const other = await get(srv.port, framePath(srv.port));
    assert.notEqual(importMap(other.body).nonce, nonce);
  } finally {
    await srv.close();
  }
});

test('bad and blocked sources get no frame', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'frame-'));
  const file = join(dir, 'blocklist.json');
  await writeFile(file, '{"repos":["Maker/Fun-Games"]}');
  const srv = await startServer({ BLOCKLIST: file });
  try {
    const bad = await get(srv.port, framePath(srv.port, 'gh:nope'));
    assert.equal(bad.status, 400);
    assert.doesNotMatch(bad.body, /<script/);
    assert.equal((await get(srv.port, '/frame/')).status, 400, 'no src at all');
    assert.equal((await get(srv.port, framePath(srv.port, REF, 'javascript:alert(1)'))).status, 400, 'a parent that is not an origin');
    assert.equal((await get(srv.port, framePath(srv.port, REF, 'http://127.0.0.1/x'))).status, 400, 'a parent with a path');
    const blocked = await get(srv.port, framePath(srv.port));
    assert.equal(blocked.status, 403);
    assert.ok(blocked.body.includes(COPY.blocked));
    assert.doesNotMatch(blocked.body, /<script/);
  } finally {
    await srv.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('frame scripts are served with CORS', async () => {
  const srv = await startServer();
  try {
    for (const path of ['/frame/boot.js', '/frame/game-api.js', '/frame/runner-core.js']) {
      const res = await get(srv.port, path);
      assert.equal(res.status, 200, path);
      assert.equal(res.headers['access-control-allow-origin'], '*', path);
      assert.match(res.headers['content-type'], /^text\/javascript/, path);
    }
  } finally {
    await srv.close();
  }
});

test('with the dev CDN, the frame loads the game and three.js from this server', async () => {
  const srv = await startServer({ DEV_CDN: '1' });
  try {
    const play = `http://127.0.0.1:${srv.port}`;
    const res = await get(srv.port, framePath(srv.port));
    assert.equal(res.status, 200);
    const { map } = importMap(res.body);
    const base = refBase(`${play}/dev-cdn/gh/`, REF);
    assert.equal(map.scopes[base][`${play}/client/`], `${base}client/`);
    assert.equal(map.imports.three, `${play}/vendor/three/three.module.js`);
    assert.equal(map.imports['three/addons/'], `${play}/vendor/three-addons/`);
    assert.equal((await get(srv.port, '/vendor/three/three.module.js')).status, 200, 'three resolves');
    const d = csp(res.headers['content-security-policy']);
    assert.ok(d['script-src'].includes(`${play}/dev-cdn/`));
    assert.ok(d['script-src'].includes(`${play}/vendor/`));
    assert.ok(d['connect-src'].includes(`${play}/dev-cdn/`));
    assert.ok(!d['script-src'].includes(play), 'not the whole play origin');
  } finally {
    await srv.close();
  }
});

test('the game api mirrors the room and posts to the parent', () => {
  const posted = [];
  const bridge = createBridge((kind, fields) => posted.push({ kind, ...fields }));
  const room = {
    id: 'ABCDEF',
    hostId: 'p1',
    game: { id: 'tag', name: 'Tag', teams: [{ id: 'red', name: 'Red', color: '#f00' }, { id: 'blue', name: 'Blue', color: '#00f' }] },
    settings: { rounds: 3 },
    match: { settings: { rounds: 5 } },
    teamScores: { red: 2 },
    players: [
      { id: 'p1', name: 'Ann', team: 'red', lockedTeam: 'red' },
      { id: 'p2', name: 'Bob', team: 'blue', spectating: true },
    ],
  };
  bridge.init({ me: 'p1', room, serverOffset: 1000, rtt: 40 });
  const root = { tag: 'root' };
  const hud = { tag: 'hud' };
  const api = createGameApi(bridge, { root, hud });

  // Every field the server-run match screen gives a game.
  for (const key of ['root', 'hud', 'gameId', 'me', 'room', 'settings', 'teams', 'isHost', 'spectating', 'canPickTeam', 'pickTeam',
    'player', 'players', 'team', 'teamColor', 'teamScore', 'send', 'on', 'onMatchEnd', 'onRoom', 'serverNow', 'rtt', 'toast', 'ui']) {
    assert.ok(key in api, key);
  }
  for (const key of ['isBlocking', 'on', 'openMenu', 'openTeamPicker', 'showScorebar', 'showHint']) assert.ok(key in api.ui, `ui.${key}`);

  assert.equal(api.root, root);
  assert.equal(api.hud, hud);
  assert.equal(api.gameId, 'tag');
  assert.equal(api.me, 'p1');
  assert.equal(api.isHost, true);
  assert.equal(api.spectating, false);
  assert.deepEqual(api.settings, { rounds: 5 });
  assert.equal(api.teams.length, 2);
  assert.equal(api.player().name, 'Ann');
  assert.equal(api.player('p2').name, 'Bob');
  assert.equal(api.player('nobody'), null);
  assert.equal(api.players().length, 2);
  assert.equal(api.team('blue').name, 'Blue');
  assert.equal(api.teamColor('red'), '#f00');
  assert.equal(api.teamColor('green'), '#cccccc');
  assert.equal(api.teamScore('red'), 2);
  assert.equal(api.teamScore('blue'), 0);
  assert.equal(api.rtt(), 40);
  const now = api.serverNow();
  assert.ok(Math.abs(now - (Date.now() + 1000)) < 50);
  // The same rule as components.js: a locked player may only rejoin their own team.
  assert.equal(api.canPickTeam('red'), true);
  assert.equal(api.canPickTeam('blue'), false);

  // Game messages, room updates and match end reach the game.
  const got = [];
  const off = api.on('state', (d) => got.push(d));
  bridge.gameMessage('state', { n: 1 });
  off();
  bridge.gameMessage('state', { n: 2 });
  assert.deepEqual(got, [{ n: 1 }]);
  let seen = null;
  api.onRoom((r) => { seen = r; });
  bridge.setRoom({ ...room, hostId: 'p2', players: [{ id: 'p1', name: 'Ann', team: 'red', spectating: true }] });
  assert.equal(seen.hostId, 'p2');
  assert.equal(api.isHost, false);
  assert.equal(api.spectating, true);
  assert.equal(api.canPickTeam('blue'), true, 'no longer locked');

  // UI state comes from the parent.
  const ui = [];
  api.ui.on('block', () => ui.push('block'));
  api.ui.on('resume', () => ui.push('resume'));
  bridge.setUi({ blocking: true, event: 'block' });
  assert.equal(api.ui.isBlocking(), true);
  bridge.setUi({ blocking: false, event: 'resume' });
  assert.equal(api.ui.isBlocking(), false);
  assert.deepEqual(ui, ['block', 'resume']);

  // What the game does goes to the parent as plain JSON.
  posted.length = 0;
  api.send('input', { dx: 1, fn: () => 1, at: undefined });
  api.pickTeam('auto');
  api.ui.openMenu();
  api.ui.openTeamPicker();
  api.ui.showScorebar(false);
  api.ui.showHint(true);
  api.toast('hi', 'ok');
  assert.deepEqual(posted, [
    { kind: 'send', type: 'input', data: { dx: 1 } },
    { kind: 'pickTeam', team: 'auto' },
    { kind: 'ui', action: 'openMenu' },
    { kind: 'ui', action: 'openTeamPicker' },
    { kind: 'ui', action: 'showScorebar', show: false },
    { kind: 'ui', action: 'showHint', show: true },
    // The envelope's `kind` is the message kind, so the toast's own kind travels as toastKind.
    { kind: 'toast', text: 'hi', toastKind: 'ok' },
  ]);

  // onMatchEnd: the parent learns whether the game handles the end itself.
  posted.length = 0;
  const results = [];
  const offEnd = api.onMatchEnd((r) => results.push(r));
  assert.deepEqual(posted, [{ kind: 'handlesMatchEnd', handles: true }]);
  bridge.matchEnded({ text: 'gg' });
  assert.deepEqual(results, [{ text: 'gg' }]);
  offEnd();
  assert.deepEqual(posted.at(-1), { kind: 'handlesMatchEnd', handles: false });

  // destroy() drops every handler the game registered.
  const after = [];
  api.on('state', (d) => after.push(d));
  bridge.destroy();
  bridge.gameMessage('state', { n: 3 });
  assert.deepEqual(after, []);
});
