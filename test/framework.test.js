import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, TestClient, sleep } from './helpers.js';

let srv;
const clients = [];

before(async () => {
  srv = await startServer();
});

after(async () => {
  for (const c of clients) c.close();
  await srv.close();
});

async function client(opts) {
  const c = new TestClient(srv.base, opts);
  clients.push(c);
  await c.connect();
  return c;
}

async function createRoom(name = 'Host', password = 'secret', game = 'dots') {
  const host = await client();
  host.send('room:create', { name, password, game });
  const welcome = await host.next((m) => m.t === 'welcome');
  return { host, room: welcome.room, welcome };
}

test('hello lists the available games', async () => {
  const c = await client();
  const hello = c.messages[0];
  assert.equal(hello.t, 'hello');
  const ids = hello.games.map((g) => g.id);
  assert.ok(ids.includes('dots'));
  assert.ok(ids.includes('solo'));
});

test('create a room, join with the right password, reject the wrong one', async () => {
  const { host, room } = await createRoom('Alice', 'hunter2');
  assert.match(room.id, /^[A-Z2-9]{6}$/);
  assert.equal(room.hasPassword, true);
  assert.equal(room.phase, 'lobby');
  assert.equal(room.hostId, room.players[0].id);

  const bad = await client();
  bad.send('room:join', { roomId: room.id, password: 'nope', name: 'Mallory' });
  const err = await bad.next((m) => m.t === 'error');
  assert.equal(err.code, 'wrong_password');

  const bob = await client();
  bob.send('room:join', { roomId: room.id.toLowerCase(), password: 'hunter2', name: 'Bob' });
  const w = await bob.next((m) => m.t === 'welcome');
  assert.equal(w.room.players.length, 2);

  // Teams are auto-balanced on join.
  const r = await host.roomWhere((x) => x.players.length === 2);
  const teams = r.players.map((p) => p.team).sort();
  assert.deepEqual(teams, ['blue', 'red']);
});

test('unknown room code is rejected', async () => {
  const c = await client();
  c.send('room:join', { roomId: 'ZZZZZZ', password: '', name: 'X' });
  const err = await c.next((m) => m.t === 'error');
  assert.equal(err.code, 'room_not_found');
});

test('room without password can be joined with an empty password', async () => {
  const { room } = await createRoom('Open', '');
  assert.equal(room.hasPassword, false);
  const c = await client();
  c.send('room:join', { roomId: room.id, name: 'Guest' });
  await c.next((m) => m.t === 'welcome');
});

test('duplicate names get a suffix', async () => {
  const { room } = await createRoom('Sam', 'pw');
  const c = await client();
  c.send('room:join', { roomId: room.id, password: 'pw', name: 'sam' });
  const w = await c.next((m) => m.t === 'welcome');
  assert.deepEqual(w.room.players.map((p) => p.name).sort(), ['Sam', 'sam 2']);
});

test('only the host can start, configure, or kick', async () => {
  const { host, room } = await createRoom('Host', 'pw');
  const guest = await client();
  guest.send('room:join', { roomId: room.id, password: 'pw', name: 'Guest' });
  await guest.next((m) => m.t === 'welcome');

  guest.send('room:start');
  assert.equal((await guest.next((m) => m.t === 'error')).code, 'not_host');
  guest.send('room:config', { settings: { scoreLimit: 5 } });
  assert.equal((await guest.next((m) => m.t === 'error')).code, 'not_host');

  host.send('room:config', { settings: { scoreLimit: 5, timeLimit: 9999, bogus: 1 } });
  const r = await host.nextRoomWhere((x) => x.settings.scoreLimit === 5);
  assert.equal(r.settings.timeLimit, 60, 'clamped to max');
  assert.ok(!('bogus' in r.settings));

  host.send('room:start');
  const started = await guest.next((m) => m.t === 'match:start');
  assert.equal(started.game, 'dots');
  assert.equal(started.settings.scoreLimit, 5);
  await guest.roomWhere((x) => x.phase === 'playing');

  // Settings are locked during a match.
  host.send('room:config', { settings: { scoreLimit: 7 } });
  assert.equal((await host.next((m) => m.t === 'error')).code, 'bad_phase');

  host.send('room:end');
  const end = await guest.next((m) => m.t === 'match:end');
  assert.match(end.result.text, /ended the match/);
  await guest.nextRoomWhere((x) => x.phase === 'lobby');
});

test('players can pick a team and everyone sees it', async () => {
  const { host, room } = await createRoom('Host', 'pw');
  const me = room.players[0].id;
  host.send('team:pick', { team: 'blue' });
  await host.nextRoomWhere((x) => x.players.find((p) => p.id === me).team === 'blue');
  host.send('team:pick', { team: 'green' });
  assert.equal((await host.next((m) => m.t === 'error')).code, 'bad_team');
});

test('host leaving passes host to the next player; empty rooms close', async () => {
  const { host, room } = await createRoom('Host', 'pw');
  const guest = await client();
  guest.send('room:join', { roomId: room.id, password: 'pw', name: 'Guest' });
  const w = await guest.next((m) => m.t === 'welcome');
  host.send('room:leave');
  await host.next((m) => m.t === 'left');
  const r = await guest.nextRoomWhere((x) => x.players.length === 1);
  assert.equal(r.hostId, w.you);

  guest.send('room:leave');
  await guest.next((m) => m.t === 'left');
  await sleep(50);
  const c = await client();
  c.send('room:join', { roomId: room.id, password: 'pw', name: 'Late' });
  assert.equal((await c.next((m) => m.t === 'error')).code, 'room_not_found');
});

test('reconnect with the session token keeps your seat', async () => {
  const { host, room, welcome } = await createRoom('Host', 'pw');
  const guest = await client();
  guest.send('room:join', { roomId: room.id, password: 'pw', name: 'Flaky' });
  const gw = await guest.next((m) => m.t === 'welcome');
  guest.close();
  await host.nextRoomWhere((x) => x.players.some((p) => p.id === gw.you && !p.connected));

  const again = await client();
  again.send('room:join', { roomId: room.id, token: gw.token, resume: true });
  const w2 = await again.next((m) => m.t === 'welcome');
  assert.equal(w2.you, gw.you);
  await host.nextRoomWhere((x) => x.players.find((p) => p.id === gw.you)?.connected);

  // A stale token never falls through to a normal join.
  const stale = await client();
  stale.send('room:join', { roomId: room.id, token: 'bogus', resume: true });
  assert.equal((await stale.next((m) => m.t === 'error')).code, 'session_expired');
  assert.ok(welcome.token);
});

test('disconnected players are removed after the grace period', async () => {
  const { host, room } = await createRoom('Host', 'pw');
  const guest = await client();
  guest.send('room:join', { roomId: room.id, password: 'pw', name: 'Gone' });
  await guest.next((m) => m.t === 'welcome');
  guest.close();
  await host.nextRoomWhere((x) => x.players.length === 1, 3000);
});

test('chat is broadcast and sanitized', async () => {
  const { host, room } = await createRoom('Host', 'pw');
  const guest = await client();
  guest.send('room:join', { roomId: room.id, password: 'pw', name: 'Talker' });
  await guest.next((m) => m.t === 'welcome');
  guest.send('chat', { text: '  hi\u0000 <b>there</b>  ' });
  const msg = await host.next((m) => m.t === 'chat' && !m.system);
  assert.equal(msg.text, 'hi <b>there</b>'); // HTML is escaped by the client (textContent), not stripped
  assert.equal(msg.name, 'Talker');
});

test('wrong passwords are rate limited per IP', async () => {
  const { room } = await createRoom('Host', 'correct');
  const c = await client();
  let lockedOut = false;
  for (let i = 0; i < 12; i++) {
    c.send('room:join', { roomId: room.id, password: `guess${i}`, name: 'Brute' });
    const err = await c.next((m) => m.t === 'error');
    if (err.code === 'locked_out') {
      lockedOut = true;
      break;
    }
  }
  assert.ok(lockedOut);
  // Even the right password is refused while locked out.
  c.send('room:join', { roomId: room.id, password: 'correct', name: 'Brute' });
  assert.equal((await c.next((m) => m.t === 'error')).code, 'locked_out');
  // Clear the lock so later tests (same IP) aren't affected.
  srv.server.manager.ipFailures.entries.clear();
});

test('websocket from a foreign origin is refused', async () => {
  const c = new TestClient(srv.base, { origin: 'https://evil.example' });
  await assert.rejects(() => c.connect(), /403/);
});

test('Cf-Connecting-Ip is only trusted in tunnel mode and only from loopback', async () => {
  const { clientIp } = await import('../server/security.js');
  const req = (remote, cf) => ({ socket: { remoteAddress: remote }, headers: cf ? { 'cf-connecting-ip': cf } : {} });
  const tunnel = { trustCloudflare: true, trustProxy: false };
  const local = { trustCloudflare: false, trustProxy: false };
  assert.equal(clientIp(req('127.0.0.1', '203.0.113.7'), tunnel), '203.0.113.7');
  assert.equal(clientIp(req('::ffff:127.0.0.1', '203.0.113.7'), tunnel), '203.0.113.7');
  assert.equal(clientIp(req('198.51.100.2', '203.0.113.7'), tunnel), '198.51.100.2', 'not from cloudflared: ignore header');
  assert.equal(clientIp(req('127.0.0.1', '203.0.113.7'), local), '127.0.0.1', 'no tunnel: ignore header');
});

test('a runtime-added host (tunnel hostname) is accepted, others are not', async () => {
  const { isHostAllowed } = await import('../server/security.js');
  const config = { allowedHosts: ['abc-def.trycloudflare.com'] };
  assert.equal(isHostAllowed({ headers: { host: 'abc-def.trycloudflare.com' } }, config), true);
  assert.equal(isHostAllowed({ headers: { host: 'other.trycloudflare.com' } }, config), false);
  assert.equal(isHostAllowed({ headers: { host: 'localhost:8080' } }, config), true);
});

test('switching games in the lobby resets teams to fit the new game', async () => {
  const { host } = await createRoom('Host', 'pw');
  host.send('room:config', { game: 'solo' });
  const r = await host.nextRoomWhere((x) => x.game.id === 'solo');
  assert.equal(r.game.teams, null);
  assert.equal(r.players[0].team, null);
  host.send('room:config', { game: 'nope' });
  assert.equal((await host.next((m) => m.t === 'error')).code, 'unknown_game');
});

test('a results period keeps the match alive, then returns to the lobby', async () => {
  const { host } = await createRoom('Host', '', 'solo');
  host.send('room:start');
  await host.next((m) => m.t === 'match:start');
  host.send('match:ready');
  await host.nextGame('state');
  const room = [...srv.server.manager.rooms.values()].find((r) => r.def.id === 'solo' && r.match);

  let resultsHookCalls = 0;
  room.match.hooks.onResults = () => { resultsHookCalls++; };
  room.match.ctx.endMatch({ winner: null, text: 'Time!' }, { resultsSeconds: 0.4 });
  const end = await host.next((m) => m.t === 'match:end');
  assert.ok(end.result.returnAt > Date.now() - 50);
  assert.equal(resultsHookCalls, 1);
  assert.equal(room.phase, 'results');
  assert.equal(room.match.ctx.phase, 'results');
  // The game keeps ticking during the results period.
  await host.nextGame('state');
  host.send('room:start');
  assert.equal((await host.next((m) => m.t === 'error')).code, 'bad_phase');

  await host.nextRoomWhere((r) => r.phase === 'lobby' && r.match === null, 2000);
  assert.equal(room.match, null);
});

test('the host can skip the results period', async () => {
  const { host } = await createRoom('Host', '', 'solo');
  host.send('room:start');
  await host.next((m) => m.t === 'match:start');
  host.send('match:ready');
  const room = [...srv.server.manager.rooms.values()].find((r) => r.def.id === 'solo' && r.match && r.players.size === 1 && r.phase === 'playing');
  room.match.ctx.endMatch({ text: 'done' }, { resultsSeconds: 30 });
  await host.next((m) => m.t === 'match:end');
  host.send('room:end');
  await host.nextRoomWhere((r) => r.phase === 'lobby' && r.match === null);
});

test('per-player stats and the winner reach everyone at the end of a match', async () => {
  const { host } = await createRoom('Solo', '', 'solo');
  host.send('room:config', { settings: { target: 3 } });
  await host.nextRoomWhere((x) => x.settings.target === 3);
  host.send('room:start');
  await host.next((m) => m.t === 'match:start');
  host.send('match:ready');
  const state = await host.nextGame('state');
  assert.equal(state.players.length, 1);
  const room = [...srv.server.manager.rooms.values()].find((r) => r.def.id === 'solo' && r.match);
  const pid = state.players[0];
  for (let i = 0; i < 3; i++) room.match.ctx.addStat(pid, 'points');
  room.match.ctx.endMatch({ winner: pid, text: 'done' });
  const end = await host.next((m) => m.t === 'match:end');
  assert.equal(end.result.winner, pid);
  assert.equal(end.result.stats[pid].points, 3);
});
