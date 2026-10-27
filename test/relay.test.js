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
  return { host, guest, hostId: hw.you, hostToken: hw.token, guestId: gw.you, roomId: hw.room.id, settings: hw.room.settings };
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
    // The player as the server has it, so the runner needs no snapshot to know who joined.
    assert.deepEqual(j.player, { id: j.id, name: j.id === s.hostId ? 'Host' : 'Guest', team: null, bot: false, spectating: false, connected: true });
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
  const guest = r.players.find((p) => p.id === s.guestId);
  assert.equal(guest.stats.points, 3);
  // Stat keys called name or team never overwrite the player's own in the results.
  relay(s.host, [ctx('setStat', s.guestId, 'name', 'Evil'), ctx('setStat', s.guestId, 'team', 'green'), ctx('endMatch', { text: 'done' })]);
  const end = await s.guest.next((m) => m.t === 'match:end');
  assert.equal(end.result.stats[s.guestId].name, 'Guest');
  assert.equal(end.result.stats[s.guestId].team, guest.team);
  assert.equal(end.result.stats[s.guestId].points, 3);
});

test('a player holds at most 32 stat keys', async () => {
  const s = await setup();
  await play(s);
  relay(s.host, Array.from({ length: 40 }, (_, i) => ctx('setStat', s.guestId, `k${i}`, i)));
  relay(s.host, [ctx('setStat', s.guestId, 'k0', 99)]);
  const r = await s.host.nextRoomWhere((x) => x.players.find((p) => p.id === s.guestId).stats.k0 === 99);
  const stats = r.players.find((p) => p.id === s.guestId).stats;
  assert.equal(Object.keys(stats).length, 32);
  assert.equal(stats.k31, 31);
  assert.equal(stats.k32, undefined);
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
  const team = await s.host.next(isEvent('team'));
  assert.deepEqual({ id: team.id, o: team.oldTeam }, { id: s.guestId, o: oldTeam });
  assert.deepEqual(team.player, { id: s.guestId, name: 'Guest', team: newTeam, bot: false, spectating: false, connected: true });
  s.guest.send('team:pick', { team: 'spectate' });
  const watching = await s.host.next(isEvent('spectate'));
  assert.equal(watching.spectating, true);
  assert.deepEqual({ team: watching.player.team, spectating: watching.player.spectating }, { team: null, spectating: true });
  s.guest.send('team:pick', { team: newTeam });
  const back = await s.host.next(isEvent('spectate'));
  assert.equal(back.spectating, false);
  assert.deepEqual({ team: back.player.team, spectating: back.player.spectating }, { team: newTeam, spectating: false });
  s.guest.send('room:leave');
  const leave = await s.host.next(isEvent('leave'));
  assert.equal(leave.id, s.guestId);
  assert.equal(leave.player.id, s.guestId);
  assert.equal(leave.player.name, 'Guest');
  s.host.send('room:end');
  await s.host.next(isEvent('end'));
});

test('a player whose socket drops leaves with connected: false', async () => {
  const s = await setup();
  await play(s);
  s.guest.close();
  const leave = await s.host.next(isEvent('leave'));
  assert.equal(leave.id, s.guestId);
  assert.equal(leave.player.connected, false);
});

test('a runner sending 200 relays a second for 2 s is not dropped or disconnected', async () => {
  const s = await setup();
  await play(s);
  let closed = false;
  s.host.ws.once('close', () => { closed = true; });
  // The runner also plays: its own input goes through the shared limit at the same time.
  for (let tick = 0; tick < 20; tick++) {
    for (let i = 0; i < 20; i++) relay(s.host, [out('all', 'steady', tick * 20 + i)]);
    for (let i = 0; i < 10; i++) s.host.game('input', { n: tick * 10 + i });
    await sleep(100);
  }
  await sync(s, 4);
  assert.equal(s.guest.messages.filter((m) => m.t === 'game' && m.type === 'steady').length, 400);
  assert.equal(s.host.messages.filter((m) => m.t === 'relay:in' && m.from === s.hostId).length, 200);
  assert.ok(!s.guest.messages.some((m) => m.t === 'match:end'));
  assert.equal(closed, false);
});

test('a runner flooding relays ends the match, not the socket', async () => {
  const s = await setup();
  await play(s);
  for (let i = 0; i < 1500; i++) relay(s.host, [out('all', 'flood', i)]);
  const end = await s.guest.next((m) => m.t === 'match:end', 5000);
  assert.equal(end.result.text, COPY.gameTooChatty);
  assert.equal(end.result.error, true);
  s.host.send('ping', { c: 1 });
  await s.host.next((m) => m.t === 'pong');
  assert.equal(s.guest.messages.filter((m) => m.t === 'match:end').length, 1);
});

test('the runner seat taken by another connection ends the match', async () => {
  const s = await setup();
  await play(s);
  const again = await client();
  again.send('room:join', { roomId: s.roomId, token: s.hostToken, resume: true });
  await again.next((m) => m.t === 'welcome');
  const end = await s.guest.next((m) => m.t === 'match:end');
  assert.equal(end.result.text, COPY.hostLeft);
});

test('a big relay just after the match closed gets bad_phase, and the socket stays open', async () => {
  const s = await setup();
  await play(s);
  s.host.send('room:end');
  await s.host.next((m) => m.t === 'match:end');
  relay(s.host, [out('all', 'late', 'x'.repeat(100 * 1024))]);
  assert.equal((await s.host.next((m) => m.t === 'error')).code, 'bad_phase');
  s.host.send('ping', { c: 1 });
  await s.host.next((m) => m.t === 'pong');
});

// Just under MAX_RELAY_BYTES once wrapped: each one costs 16 tokens of the runner's relay bucket.
const HUGE = 'x'.repeat(256 * 1024 - 200);

test('a host flooding huge relays in the lobby is disconnected', { timeout: 15000 }, async () => {
  const s = await setup();
  const closed = new Promise((resolve) => s.host.ws.once('close', (code) => resolve(code)));
  for (let i = 0; i < 320; i++) relay(s.host, [out('all', 'huge', HUGE)]);
  assert.equal(await closed, 1008);
});

test('huge relays over the budget during a match end it, and the socket stays open', { timeout: 20000 }, async () => {
  const s = await setup();
  await play(s);
  // Skipped items (no such target) keep the test from echoing megabytes back.
  for (let i = 0; i < 300; i++) relay(s.host, [{ k: 'out', to: 'nobody', type: 'huge', data: HUGE }]);
  const end = await s.guest.next((m) => m.t === 'match:end', 10000);
  assert.equal(end.result.text, COPY.gameTooChatty);
  s.host.send('ping', { c: 1 });
  await s.host.next((m) => m.t === 'pong', 10000);
  assert.equal(s.host.ws.readyState, 1);
});

// ---- lobby bots in a remote room: players the runner controls, with no socket ----

/** A remote room with only a host. */
async function soloHost(def) {
  const host = await client();
  host.send('room:create', { name: 'Host', password: '', source: SOURCE, def });
  const hw = await host.next((m) => m.t === 'welcome');
  return { host, hostId: hw.you, roomId: hw.room.id };
}

const room = (roomId) => srv.server.manager.rooms.get(roomId);

test("a remote room's host adds bots that need no socket", async () => {
  const { host, hostId, roomId } = await soloHost(metaOf(dots, true));
  const sockets = srv.server.wss.clients.size;
  host.send('room:bots', { add: 2 });
  const r = await host.roomWhere((x) => x.players.filter((p) => p.bot).length === 2);
  const bots = r.players.filter((p) => p.bot);
  assert.ok(bots.every((p) => p.connected));
  assert.equal(r.botsSupported, true);
  assert.equal(r.hostId, hostId, 'the host stays host');
  assert.equal(new Set(bots.map((p) => p.name)).size, 2, 'unique names');
  assert.equal(srv.server.wss.clients.size, sockets, 'no new sockets');
  host.send('room:bots', { remove: 'all' });
  await host.nextRoomWhere((x) => x.players.length === 1);
});

test('bots in a remote room join the match as virtual players', async () => {
  const s = await setup(metaOf(dots, true));
  s.host.send('room:bots', { add: 2, difficulty: 'hard' });
  const r = await s.host.roomWhere((x) => x.players.filter((p) => p.bot).length === 2);
  const botIds = r.players.filter((p) => p.bot).map((p) => p.id);
  await play(s);
  for (const id of botIds) {
    const join = await s.host.waitFor(isEvent('join', (m) => m.id === id));
    assert.equal(join.virtual, true);
    assert.equal(join.spectator, false);
    assert.deepEqual(join.options, { difficulty: 'hard' });
  }
  // Humans still join as themselves, and bots take part in team sends.
  const humanJoin = s.host.messages.find(isEvent('join', (m) => m.id === s.guestId));
  assert.equal(humanJoin.virtual, false);
  assert.deepEqual(humanJoin.options, {});
  assert.ok(!s.guest.messages.some((m) => m.t.startsWith('relay')));
  const inMatch = await s.host.roomWhere((x) => x.players.filter((p) => p.inMatch).length === 4);
  assert.ok(inMatch.players.filter((p) => p.bot).every((p) => p.inMatch));
});

test('a bot added during a match joins it at once, and removing it tells the runner', async () => {
  const s = await setup(metaOf(dots, true));
  await play(s);
  s.host.send('room:bots', { add: 1, team: 'red' });
  const join = await s.host.next(isEvent('join', (m) => m.virtual === true));
  assert.deepEqual(join.options, { difficulty: 'normal' });
  s.host.send('room:bots', { remove: join.id });
  const leave = await s.host.next(isEvent('leave', (m) => m.id === join.id));
  assert.equal(leave.id, join.id);
});

test('remote auto-fill tops teams up with virtual bots', async () => {
  const meta = { ...metaOf(dots, true), autoFill: { perTeam: 2 } };
  const s = await soloHost(meta);
  const sockets = srv.server.wss.clients.size;
  s.host.send('room:start');
  await s.host.next((m) => m.t === 'match:start');
  const r = await s.host.roomWhere((x) => x.phase === 'playing' && x.players.filter((p) => p.bot).length === 3);
  const bots = r.players.filter((p) => p.bot);
  const counts = { red: 0, blue: 0 };
  for (const p of r.players) counts[p.team]++;
  assert.deepEqual(counts, { red: 2, blue: 2 });
  assert.equal(srv.server.wss.clients.size, sockets);
  s.host.send('match:ready');
  for (const b of bots) {
    const join = await s.host.waitFor(isEvent('join', (m) => m.id === b.id));
    assert.equal(join.virtual, true);
  }
  // Fillers leave with the match, which the runner hears as its end.
  s.host.send('room:end');
  await s.host.waitFor(isEvent('end'));
  await s.host.nextRoomWhere((x) => x.phase === 'lobby' && x.players.length === 1);
});

test('without hasBot, bots are refused', async () => {
  const { host } = await soloHost(metaOf(dots, false));
  host.send('room:bots', { add: 1 });
  assert.equal((await host.next((m) => m.t === 'error')).code, 'no_bots');
  const r = await host.roomWhere(() => true);
  assert.equal(r.botsSupported, false);
});

test('bots alone never keep a remote room open', async () => {
  const { host, roomId } = await soloHost(metaOf(dots, true));
  host.send('room:bots', { add: 2 });
  await host.roomWhere((x) => x.players.filter((p) => p.bot).length === 2);
  assert.ok(room(roomId));
  host.send('room:leave');
  await sleep(150);
  assert.equal(srv.server.manager.rooms.has(roomId), false);
});

test('adding or removing several bots is one chat line each', async () => {
  const s = await setup(metaOf(dots, true));
  const lines = () => s.guest.messages.filter((m) => m.t === 'chat' && m.system).map((m) => m.text);
  s.host.send('room:bots', { add: 3 });
  await s.guest.roomWhere((x) => x.players.filter((p) => p.bot).length === 3);
  s.host.send('room:bots', { remove: 'all' });
  await s.guest.nextRoomWhere((x) => x.players.length === 2);
  await sleep(100);
  const botLines = lines().filter((t) => t.includes('bot'));
  assert.deepEqual(botLines, ['3 bots joined.', '3 bots left.']);
});

test('bot add and remove requests are rate limited in a remote room', async () => {
  const s = await setup(metaOf(dots, true));
  for (let i = 0; i < 10; i++) {
    s.host.send('room:bots', { add: 1 });
    s.host.send('room:bots', { remove: 'all' });
  }
  await sleep(300);
  const errors = s.host.messages.filter((m) => m.t === 'error').map((m) => m.code);
  assert.ok(errors.length >= 12, `expected most of 20 requests refused, got ${errors.length}`);
  assert.ok(errors.every((c) => c === 'rate_limited'), errors.join());
  // The guest saw a handful of batches, not twenty.
  const botLines = s.guest.messages.filter((m) => m.t === 'chat' && m.system && m.text.includes('bot'));
  assert.ok(botLines.length <= 8, `guest got ${botLines.length} bot lines`);
});

test('auto-fill hands the runner only a known difficulty', async () => {
  const meta = {
    ...metaOf(dots, true),
    settings: [...metaOf(dots).settings, { key: 'skill', type: 'select', default: 'brutal', options: ['brutal', 'hard'] }],
    autoFill: { perTeam: 1, difficultySetting: 'skill' },
  };
  const s = await soloHost(meta);
  s.host.send('room:start');
  await s.host.next((m) => m.t === 'match:start');
  const join = await s.host.waitFor(isEvent('join', (m) => m.virtual === true));
  assert.deepEqual(join.options, { difficulty: 'normal' });
});
