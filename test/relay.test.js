import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, TestClient, sleep } from './helpers.js';
import { COPY } from '../shared/copy.js';
import starter from '../templates/starter/server.js';
import dots from './fixtures/games/dots/server.js';

const SOURCE = 'gh:test/friendslop@' + '0'.repeat(40) + '/templates/starter';

// Stands in for describeGame(def, { hasBot }): everything defineGame returns except create, as JSON.
function metaOf(def, hasBot = false) {
  const { create, ...rest } = JSON.parse(JSON.stringify(def));
  return { ...rest, hasBot };
}

let srv;
let clients = [];

before(async () => {
  srv = await startServer();
});

afterEach(() => {
  // Keeps the run under the per-IP connection limit.
  for (const c of clients) c.close();
  clients = [];
});

after(async () => {
  await srv.close();
});

async function client() {
  const c = new TestClient(srv.base);
  clients.push(c);
  await c.connect();
  return c;
}

/** A remote room with a host (who acts as the runner by hand) and one guest. */
async function setup(def = metaOf(starter)) {
  const host = await client();
  host.send('room:create', { name: 'Host', password: '', source: SOURCE, def });
  const hw = await host.next((m) => m.t === 'welcome');
  const guest = await client();
  guest.send('room:join', { roomId: hw.room.id, password: '', name: 'Guest' });
  const gw = await guest.next((m) => m.t === 'welcome');
  return { host, guest, hostId: hw.you, guestId: gw.you, roomId: hw.room.id, settings: hw.room.settings };
}

const isEvent = (ev, pred = () => true) => (m) => m.t === 'relay:event' && m.ev === ev && pred(m);

/** Starts the match and loads both players; resolves once the runner has heard both joins. */
async function play(s) {
  s.host.send('room:start');
  await s.host.next((m) => m.t === 'match:start');
  await s.guest.waitFor((m) => m.t === 'match:start');
  s.host.send('match:ready');
  s.guest.send('match:ready');
  for (const id of [s.hostId, s.guestId]) await s.host.waitFor(isEvent('join', (m) => m.id === id));
}

const relay = (c, msgs) => c.send('relay', { msgs });
const out = (to, type, data, extra = {}) => ({ k: 'out', to, type, data, ...extra });
const ctx = (op, ...args) => ({ k: 'ctx', op, args });
const gameTypes = (c) => c.messages.filter((m) => m.t === 'game').map((m) => m.type);

/** Sends a final `sync` to everyone and waits for both to get it, so earlier items have all landed. */
async function sync(s, tag) {
  relay(s.host, [out('all', `sync-${tag}`, null)]);
  await s.host.waitFor((m) => m.t === 'game' && m.type === `sync-${tag}`);
  await s.guest.waitFor((m) => m.t === 'game' && m.type === `sync-${tag}`);
}

test('the runner hears the match start and each player who loads', async () => {
  const s = await setup();
  await play(s);
  const events = s.host.messages.filter((m) => m.t === 'relay:event');
  const start = events[0];
  assert.equal(start.ev, 'start');
  assert.deepEqual(start.settings, s.settings);
  assert.equal(start.game.id, 'starter');
  assert.equal(typeof start.matchId, 'string');
  assert.equal(typeof start.startedAt, 'number');
  const joins = events.filter((m) => m.ev === 'join');
  assert.deepEqual(new Set(joins.map((m) => m.id)), new Set([s.hostId, s.guestId]));
  for (const j of joins) {
    assert.equal(j.spectator, false);
    assert.equal(j.virtual, false);
  }
  assert.ok(!s.guest.messages.some((m) => m.t.startsWith('relay')), 'only the runner hears relay events');
});

test('player game messages reach only the runner', async () => {
  const s = await setup();
  await play(s);
  s.guest.game('input', { dx: 1 });
  const got = await s.host.next((m) => m.t === 'relay:in');
  assert.deepEqual({ from: got.from, type: got.type, data: got.data }, { from: s.guestId, type: 'input', data: { dx: 1 } });
  await sleep(100);
  assert.ok(!s.guest.messages.some((m) => m.t === 'relay:in' || m.t === 'game'));
});

test('relay out reaches the right players', async () => {
  const s = await setup();
  await play(s);
  relay(s.host, [out('all', 'everyone', 1), out('player', 'onlyGuest', 2, { id: s.guestId }), out('all', 'notHost', 3, { except: s.hostId })]);
  await sync(s, 1);
  assert.deepEqual(gameTypes(s.host), ['everyone', 'sync-1']);
  assert.deepEqual(gameTypes(s.guest), ['everyone', 'onlyGuest', 'notHost', 'sync-1']);
  const everyone = s.guest.messages.find((m) => m.type === 'everyone');
  assert.equal(everyone.data, 1);
});

test('relay out to a team reaches only that team', async () => {
  const s = await setup(metaOf(dots));
  const room = await s.host.roomWhere((r) => r.players.length === 2);
  const team = Object.fromEntries(room.players.map((p) => [p.id, p.team]));
  assert.notEqual(team[s.hostId], team[s.guestId]);
  await play(s);
  relay(s.host, [out('team', 'blueOnly', null, { team: 'blue' })]);
  await sync(s, 2);
  const blue = team[s.hostId] === 'blue' ? s.host : s.guest;
  const red = blue === s.host ? s.guest : s.host;
  assert.ok(gameTypes(blue).includes('blueOnly'));
  assert.ok(!gameTypes(red).includes('blueOnly'));
});

test('relay ctx updates the scoreboard', async () => {
  const s = await setup(metaOf(dots));
  await play(s);
  relay(s.host, [ctx('setStat', s.guestId, 'points', 3), ctx('setTeamScore', 'red', 2)]);
  const r = await s.host.nextRoomWhere((x) => x.teamScores.red === 2);
  assert.equal(r.players.find((p) => p.id === s.guestId).stats.points, 3);
});

test('bad relay items are skipped', async () => {
  const s = await setup(metaOf(dots));
  await play(s);
  const playing = await s.host.roomWhere((x) => x.phase === 'playing');
  const guestTeam = playing.players.find((p) => p.id === s.guestId).team;
  relay(s.host, [
    null,
    { k: 'ctx', op: 'eval', args: ['1'] },
    ctx('setStat', s.guestId, 'a b', 1),
    ctx('setStat', s.guestId, 'long', 'x'.repeat(65)),
    ctx('setTeam', s.guestId, 'green'),
    ctx('setTeamScore', 'green', 4),
    ctx('setStat', s.guestId, 'points', 5),
  ]);
  const r = await s.host.nextRoomWhere((x) => x.players.find((p) => p.id === s.guestId).stats.points === 5);
  const g = r.players.find((p) => p.id === s.guestId);
  assert.deepEqual(Object.keys(g.stats), ['points']);
  assert.equal(g.team, guestTeam);
  assert.deepEqual(r.teamScores, { red: 0, blue: 0 });
});

test('only the runner may relay', async () => {
  const s = await setup();
  await play(s);
  relay(s.guest, [out('all', 'sneaky', 1)]);
  const err = await s.guest.next((m) => m.t === 'error');
  assert.equal(err.code, 'not_runner');
  await sleep(50);
  assert.ok(!gameTypes(s.host).includes('sneaky'));
});

test('a relay outside a match is refused', async () => {
  const s = await setup();
  relay(s.host, [out('all', 'early', 1)]);
  assert.equal((await s.host.next((m) => m.t === 'error')).code, 'bad_phase');
});

test('the runner leaving ends the match with the host-left message', async () => {
  const s = await setup();
  await play(s);
  s.host.close();
  const end = await s.guest.next((m) => m.t === 'match:end');
  assert.equal(end.result.text, COPY.hostLeft);
  assert.equal(end.result.error, true);
  const r = await s.guest.roomWhere((x) => x.phase === 'lobby' && x.hostId === s.guestId && x.players.length === 1);
  assert.equal(r.id, s.roomId);
  assert.ok(srv.server.manager.rooms.has(s.roomId));
});

test('a relay batch over the item limit is refused', async () => {
  const s = await setup();
  await play(s);
  relay(s.host, Array.from({ length: 513 }, () => out('all', 'flood', 1)));
  assert.equal((await s.host.next((m) => m.t === 'error')).code, 'relay_too_big');
  s.host.send('ping', { c: 1 });
  await s.host.next((m) => m.t === 'pong');
  await sync(s, 3);
  assert.ok(!gameTypes(s.guest).includes('flood'));
});

test('a 100 KB relay batch is accepted, and a 100 KB game message is not', async () => {
  const s = await setup();
  await play(s);
  const big = 'x'.repeat(100 * 1024);
  relay(s.host, [out('all', 'big', big)]);
  const got = await s.guest.nextGame('big');
  assert.equal(got.length, big.length);
  const closed = new Promise((resolve) => s.guest.ws.once('close', (code) => resolve(code)));
  s.guest.game('big', big);
  assert.equal(await closed, 1009);
  // The runner may send big relays, but its plain game messages keep the usual limit.
  const hostClosed = new Promise((resolve) => s.host.ws.once('close', (code) => resolve(code)));
  s.host.game('big', big);
  assert.equal(await hostClosed, 1009);
});

test('a big relay from anyone but the runner closes the socket', async () => {
  const s = await setup();
  await play(s);
  const closed = new Promise((resolve) => s.guest.ws.once('close', (code) => resolve(code)));
  relay(s.guest, [out('all', 'big', 'x'.repeat(100 * 1024))]);
  assert.equal(await closed, 1009);
  await sleep(50);
  assert.ok(!gameTypes(s.host).includes('big'));
});

test('relay traffic counts toward the daily budget', async () => {
  const s = await setup();
  await play(s);
  const data = 'y'.repeat(10 * 1024);
  const size = JSON.stringify({ t: 'game', type: 'counted', data }).length;
  const sent = srv.server.traffic.bytes;
  relay(s.host, [out('all', 'counted', data)]);
  await s.host.nextGame('counted');
  await s.guest.nextGame('counted');
  assert.ok(srv.server.traffic.bytes - sent >= 2 * size);
});

test('the runner hears team changes, spectating, leaving and the end', async () => {
  const s = await setup(metaOf(dots));
  const room = await s.host.roomWhere((r) => r.players.length === 2);
  const oldTeam = room.players.find((p) => p.id === s.guestId).team;
  const newTeam = oldTeam === 'red' ? 'blue' : 'red';
  await play(s);
  s.guest.send('team:pick', { team: newTeam });
  assert.deepEqual((({ id, oldTeam: o }) => ({ id, o }))(await s.host.next(isEvent('team'))), { id: s.guestId, o: oldTeam });
  s.guest.send('team:pick', { team: 'spectate' });
  assert.equal((await s.host.next(isEvent('spectate'))).spectating, true);
  s.guest.send('team:pick', { team: newTeam });
  assert.equal((await s.host.next(isEvent('spectate'))).spectating, false);
  s.guest.send('room:leave');
  assert.equal((await s.host.next(isEvent('leave'))).id, s.guestId);
  s.host.send('room:end');
  await s.host.next(isEvent('end'));
});
