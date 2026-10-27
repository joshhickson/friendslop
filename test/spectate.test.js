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

async function client() {
  const c = new TestClient(srv.base);
  clients.push(c);
  await c.connect();
  return c;
}

/** Host + guest in a room of the test team game. */
async function setup({ options } = {}) {
  const host = await client();
  host.send('room:create', { name: 'Host', password: 'pw', game: 'dots' });
  const hw = await host.next((m) => m.t === 'welcome');
  const guest = await client();
  guest.send('room:join', { roomId: hw.room.id, password: 'pw', name: 'Guest' });
  const gw = await guest.next((m) => m.t === 'welcome');
  if (options) host.send('room:config', { options });
  const room = () => srv.server.manager.rooms.get(hw.room.id);
  const me = (r, id) => r.players.find((p) => p.id === id);
  return { host, guest, hostId: hw.you, guestId: gw.you, roomId: hw.room.id, room, me };
}

async function start(host, ...loaders) {
  host.send('room:start');
  await host.next((m) => m.t === 'match:start');
  for (const c of loaders) {
    await c.waitFor((m) => m.t === 'match:start');
    c.send('match:ready');
  }
}

test('spectating before the match: watch without playing', async () => {
  const { host, guest, guestId, room, me } = await setup();
  guest.send('team:pick', { team: 'spectate' });
  const r = await host.nextRoomWhere((x) => me(x, guestId).spectating);
  assert.equal(me(r, guestId).team, null);

  await start(host, host, guest);
  // Spectators get the broadcasts but never join the game and aren't part of its state.
  const state = await guest.nextGame('state');
  assert.ok(!state.players.some((p) => p.id === guestId));
  assert.equal(room().match.hooks.debugState(guestId), undefined);
  assert.equal(room().match.ctx.players().length, 1);
  assert.equal(room().match.ctx.spectators().length, 1);
  // Game messages from a spectator are ignored.
  guest.game('input', { dx: 1, dy: 0 });
  await sleep(100);
  assert.equal(room().match.hooks.debugState(guestId), undefined);
  host.send('room:end');
  await host.next((m) => m.t === 'match:end');
});

test('a spectator can join a team mid-match and spawns', async () => {
  const { host, guest, guestId, me } = await setup();
  guest.send('team:pick', { team: 'spectate' });
  await host.nextRoomWhere((x) => me(x, guestId).spectating);
  await start(host, host, guest);
  await guest.nextGame('state');
  const spawn = guest.nextGame('spawn', 3000);
  guest.send('team:pick', { team: 'blue' });
  const s = await spawn;
  assert.ok(s.pos[0] > 0, 'spawned on the blue side');
  const r = await host.nextRoomWhere((x) => !me(x, guestId).spectating);
  assert.equal(me(r, guestId).team, 'blue');
  host.send('room:end');
  await host.next((m) => m.t === 'match:end');
});

test('with team switching off, players can only rejoin their own team', async () => {
  const { host, guest, guestId, me } = await setup({ options: { teamSwitch: false } });
  guest.send('team:pick', { team: 'blue' });
  host.send('team:pick', { team: 'red' });
  const lobby = await host.nextRoomWhere((x) => me(x, guestId).team === 'blue' && x.options.teamSwitch === false);
  assert.equal(me(lobby, guestId).lockedTeam, null, 'free to switch in the lobby');

  await start(host, host, guest);
  await guest.nextGame('spawn');
  const r = await guest.roomWhere((x) => x.phase === 'playing' && me(x, guestId).lockedTeam === 'blue');
  assert.ok(r);
  guest.send('team:pick', { team: 'red' });
  assert.equal((await guest.next((m) => m.t === 'error')).code, 'team_locked');
  // Spectating is allowed, but it can't be used to change sides.
  guest.send('team:pick', { team: 'spectate' });
  await host.nextRoomWhere((x) => me(x, guestId).spectating);
  guest.send('team:pick', { team: 'red' });
  assert.equal((await guest.next((m) => m.t === 'error')).code, 'team_locked');
  guest.send('team:pick', { team: 'auto' });
  const back = await host.nextRoomWhere((x) => !me(x, guestId).spectating);
  assert.equal(me(back, guestId).team, 'blue');
  host.send('room:end');
  await host.next((m) => m.t === 'match:end');

  // The lock ends with the match.
  const after = await host.nextRoomWhere((x) => x.phase === 'lobby');
  assert.equal(me(after, guestId).lockedTeam, null);
});

test('spectators do not count toward the minimum players', async () => {
  const host = await client();
  host.send('room:create', { name: 'Solo', password: '', game: 'dots' });
  await host.next((m) => m.t === 'welcome');
  host.send('team:pick', { team: 'spectate' });
  await host.nextRoomWhere((x) => x.players[0].spectating);
  host.send('room:start');
  assert.equal((await host.next((m) => m.t === 'error')).code, 'not_enough_players');
  // ...but a host can spectate a match of bots.
  host.send('room:bots', { add: 2 });
  await host.roomWhere((x) => x.players.filter((p) => p.bot).length === 2, 5000);
  host.send('room:start');
  await host.next((m) => m.t === 'match:start');
  host.send('room:end');
  await host.next((m) => m.t === 'match:end');
});

test('bots cannot be made to spectate', async () => {
  const { host, room } = await setup();
  host.send('room:bots', { add: 1 });
  await host.roomWhere((x) => x.players.some((p) => p.bot), 5000);
  const bot = [...room().players.values()].find((p) => p.bot);
  assert.equal(room().pickTeam(bot, 'spectate'), 'bad_team');
});
