import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startServer, TestClient, FIXTURE_GAMES, relayHost, sleep } from './helpers.js';
import { COPY } from '../shared/copy.js';
import { describeGame } from '../client/frame/runner-core.js';
import { defineGame } from '../server/kit/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STARTER = join(ROOT, 'templates', 'starter');
const DOTS = join(FIXTURE_GAMES, 'dots');
const SOLO = join(FIXTURE_GAMES, 'solo');
const KIT_URL = pathToFileURL(join(ROOT, 'server', 'kit', 'index.js')).href;

let srv;
let tmp;
let clients = [];

before(async () => {
  srv = await startServer();
  tmp = await mkdtemp(join(tmpdir(), 'runner-'));
});

afterEach(() => {
  // Keeps the run under the per-IP connection limit, and stops each runner's ticks.
  for (const c of clients) c.close();
  clients = [];
});

after(async () => {
  await srv.close();
  await rm(tmp, { recursive: true, force: true });
});

async function client() {
  const c = new TestClient(srv.base);
  clients.push(c);
  await c.connect();
  return c;
}

/** A remote room run by `gameDir` through the real runner, with `guests` guests joined. */
async function setup(gameDir, guests = 1) {
  const h = await relayHost(srv, { gameDir });
  clients.push(h.host);
  const joined = [];
  for (let i = 0; i < guests; i++) {
    const g = await client();
    g.send('room:join', { roomId: h.roomId, password: '', name: `Guest${i + 1}` });
    const w = await g.next((m) => m.t === 'welcome');
    joined.push({ c: g, id: w.you });
  }
  await h.host.roomWhere((r) => r.players.length === 1 + guests);
  return { ...h, guests: joined, guest: joined[0]?.c, guestId: joined[0]?.id };
}

/** Starts the match and has every human load it. */
async function play(s) {
  s.host.send('room:start');
  await s.host.next((m) => m.t === 'match:start');
  s.host.send('match:ready');
  for (const g of s.guests) {
    await g.c.waitFor((m) => m.t === 'match:start');
    g.c.send('match:ready');
  }
}

/** Polls until `fn` returns something truthy. */
async function until(fn, ms = 2000, what = 'condition') {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(20);
  }
}

let tempCount = 0;
/** Writes a throwaway game whose create() body is `body`, and returns its folder. */
async function tempGame(body, extra = '') {
  const dir = join(tmp, `g${++tempCount}`);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'server.js'), [
    `import { defineGame } from ${JSON.stringify(KIT_URL)};`,
    'export default defineGame({',
    `  id: 'temp${tempCount}',`,
    '  minPlayers: 1,',
    '  tickRate: 20,',
    extra,
    `  create(ctx) { ${body} },`,
    '});',
    '',
  ].join('\n'));
  return dir;
}

const stateOf = (m, id) => m.data?.players?.find((p) => p.id === id);
const isState = (pred) => (m) => m.t === 'game' && m.type === 'state' && pred(m);

test('describeGame is the definition as JSON, without create, plus hasBot', () => {
  const def = defineGame({ id: 'meta', settings: { free: { default: 1 } }, create() { return {}; } });
  const meta = describeGame(def, { hasBot: true });
  assert.equal('create' in meta, false);
  assert.equal(meta.hasBot, true);
  assert.equal(meta.settings[0].max, null, 'Infinity becomes null, as JSON carries it');
  assert.deepEqual(meta, JSON.parse(JSON.stringify(meta)));
  assert.equal(describeGame(def).hasBot, false);
});

test('the starter runs end to end through the relay', async () => {
  const s = await setup(STARTER);
  await play(s);
  const first = await s.guest.waitFor(isState((m) => stateOf(m, s.guestId)));
  assert.ok(stateOf(first, s.hostId), 'the host is in the game too');
  s.guest.game('input', { dx: 1, dy: 0 });
  const base = stateOf(await s.guest.next(isState((m) => stateOf(m, s.guestId))), s.guestId).x;
  const later = await s.guest.next(isState((m) => stateOf(m, s.guestId).x > base), 1000);
  assert.ok(stateOf(later, s.guestId).x > base);
});

test('stats and scores set by the game reach the scoreboard', async () => {
  const s = await setup(SOLO);
  await play(s);
  await until(() => s.runner.ctx.getPlayer(s.guestId), 2000, 'the guest to join');
  s.runner.ctx.setStat(s.guestId, 'points', 3);
  assert.equal(s.runner.ctx.addStat(s.guestId, 'points', 4), 7);
  assert.equal(s.runner.ctx.stat(s.guestId, 'points'), 7);
  assert.equal(s.runner.ctx.getPlayer(s.guestId).stats.points, 7);
  const r = await s.guest.roomWhere((x) => x.players.find((p) => p.id === s.guestId)?.stats.points === 7);
  assert.equal(r.players.find((p) => p.id === s.guestId).stats.points, 7);
  s.runner.ctx.endMatch({ winner: s.guestId, text: 'Guest wins' });
  const end = await s.guest.next((m) => m.t === 'match:end');
  assert.equal(end.result.winner, s.guestId);
  assert.equal(end.result.text, 'Guest wins');
  assert.equal(end.result.stats[s.guestId].points, 7);
});

test('a game that throws in create ends the match with the crash message', async () => {
  const dir = await tempGame("throw new Error('boom');");
  const s = await setup(dir);
  await play(s);
  const end = await s.guest.waitFor((m) => m.t === 'match:end');
  assert.equal(end.result.error, true);
  assert.equal(end.result.text, COPY.gameCrashed('boom'));
});

test('a game that throws every tick is stopped after 25 errors', async () => {
  const dir = await tempGame("let n = 0; return { tick() { n++; throw new Error('tick ' + n); }, debugState() { return n; } };");
  const s = await setup(dir);
  await play(s);
  const hooks = await until(() => s.runner.hooks.debugState && s.runner.hooks, 2000, 'the game to start');
  const end = await s.guest.waitFor((m) => m.t === 'match:end', 4000);
  assert.equal(end.result.error, true);
  assert.equal(end.result.text, COPY.gameCrashed('tick 25'));
  await sleep(200);
  assert.equal(hooks.debugState(), 25, 'no tick runs after the 25th error');
});

test('a game that sends too much in one tick ends cleanly', async () => {
  const dir = await tempGame("let sent = false; return { tick() { if (sent) return; sent = true; ctx.broadcast('huge', 'x'.repeat(300 * 1024)); } };");
  const s = await setup(dir);
  await play(s);
  const end = await s.guest.waitFor((m) => m.t === 'match:end', 4000);
  assert.equal(end.result.text, COPY.gameTooChatty);
  assert.ok(!s.guest.messages.some((m) => m.t === 'game' && m.type === 'huge'));
  for (const c of [s.host, s.guest]) {
    assert.equal(c.ws.readyState, 1);
    c.send('ping', { c: 1 });
    await c.next((m) => m.t === 'pong');
  }
  assert.equal(s.guest.messages.filter((m) => m.t === 'match:end').length, 1);
});

test('virtual bots move in a remote dots room', async () => {
  const s = await setup(DOTS, 0);
  s.host.send('room:bots', { add: 1, team: 'blue' });
  const r = await s.host.roomWhere((x) => x.players.some((p) => p.bot));
  const botId = r.players.find((p) => p.bot).id;
  await play(s);
  const start = await until(() => s.runner.hooks.debugState?.(botId), 2000, 'the bot to spawn');
  const x0 = start.pos[0];
  assert.ok(x0 > 0, 'blue spawns on the right');
  await sleep(1500);
  const x1 = s.runner.hooks.debugState(botId).pos[0];
  assert.ok(Math.abs(x1 - x0) > 3, `bot moved ${Math.abs(x1 - x0)} units`);
  // The brain heard the `spawn` the game sent it on join, so it walks toward the middle.
  assert.ok(x1 < x0, `bot walked from x=${x0} to x=${x1}`);
  assert.ok(s.runner.ctx.players().some((p) => p.id === botId && p.bot));
});

test('spectators are invisible to the game', async () => {
  const s = await setup(STARTER);
  s.guest.send('team:pick', { team: 'spectate' });
  await s.host.roomWhere((x) => x.players.find((p) => p.id === s.guestId)?.spectating);
  await play(s);
  await until(() => s.runner.ctx.spectators().some((p) => p.id === s.guestId), 2000, 'the spectator to load');
  assert.ok(!s.runner.ctx.players().some((p) => p.id === s.guestId));
  assert.equal(s.runner.ctx.getPlayer(s.guestId), null);
  assert.equal(s.runner.ctx.spectators().find((p) => p.id === s.guestId).spectating, true);
  // The spectator watches the same world, but is not in it.
  const st = await s.guest.next(isState(() => true));
  assert.ok(stateOf(st, s.hostId));
  assert.equal(stateOf(st, s.guestId), undefined);
});

test('a team change mid-match reaches the game with the new team', async () => {
  const s = await setup(DOTS);
  const room = await s.host.roomWhere((r) => r.players.length === 2 && r.players.every((p) => p.team));
  const oldTeam = room.players.find((p) => p.id === s.guestId).team;
  const newTeam = oldTeam === 'red' ? 'blue' : 'red';
  await play(s);
  await until(() => s.runner.hooks.debugState?.(s.guestId), 2000, 'the guest to spawn');
  const seen = [];
  const hooks = s.runner.hooks;
  const onTeamChange = hooks.onTeamChange;
  hooks.onTeamChange = (p, old) => {
    seen.push({ team: p.team, old });
    onTeamChange(p, old);
  };
  s.guest.send('team:pick', { team: newTeam });
  await until(() => seen.length, 2000, 'onTeamChange');
  assert.deepEqual(seen, [{ team: newTeam, old: oldTeam }]);
  // dots respawns a player on their team's side: blue on the right, red on the left.
  const x = s.runner.hooks.debugState(s.guestId).pos[0];
  assert.ok(newTeam === 'blue' ? x > 0 : x < 0, `respawned at x=${x} for ${newTeam}`);
});

test('a player joining mid-match is seen by the game', async () => {
  const s = await setup(STARTER);
  await play(s);
  await s.guest.waitFor(isState((m) => stateOf(m, s.guestId)));
  const late = await client();
  late.send('room:join', { roomId: s.roomId, password: '', name: 'Late' });
  const w = await late.next((m) => m.t === 'welcome');
  assert.equal(w.room.phase, 'playing');
  late.send('match:ready');
  const st = await late.waitFor(isState((m) => stateOf(m, w.you)));
  assert.ok(stateOf(st, w.you));
  assert.equal(s.runner.ctx.getPlayer(w.you).name, 'Late');
});
