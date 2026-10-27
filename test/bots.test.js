import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { startServer, TestClient, sleep, FIXTURE_GAMES } from './helpers.js';
import { BotClient } from '../server/bots/client.js';
import { NavGrid } from '../shared/kit/navgrid.js';

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

async function hostRoom(game = 'dots', password = 'pw') {
  const host = await client();
  host.send('room:create', { name: 'Host', password, game });
  const w = await host.next((m) => m.t === 'welcome');
  return { host, roomId: w.room.id, hostId: w.you, room: () => srv.server.manager.rooms.get(w.room.id) };
}

const dotsBrain = () => import(pathToFileURL(join(FIXTURE_GAMES, 'dots', 'bot.js')).href).then((m) => m.default);

test('the host adds bots by number; each is its own WebSocket connection', async () => {
  const { host, room } = await hostRoom();
  const before = srv.server.wss.clients.size;
  host.send('room:bots', { add: 3, team: 'blue' });
  const r = await host.roomWhere((x) => x.players.filter((p) => p.bot).length === 3, 5000);
  const bots = r.players.filter((p) => p.bot);
  assert.ok(bots.every((p) => p.team === 'blue' && p.connected));
  assert.equal(new Set(bots.map((p) => p.name)).size, 3, 'unique names');
  assert.equal(srv.server.wss.clients.size - before, 3, 'three new sockets');
  assert.equal(r.botsSupported, true);
  assert.equal(r.hostId, room().hostId, 'host unchanged');

  host.send('room:bots', { add: 2, team: 'auto' });
  const r2 = await host.roomWhere((x) => x.players.filter((p) => p.bot).length === 5, 5000);
  assert.equal(r2.players.filter((p) => p.team === 'red').length, 3, 'auto fills the smaller team');

  host.send('room:bots', { remove: bots[0].id });
  await host.nextRoomWhere((x) => x.players.filter((p) => p.bot).length === 4);
  host.send('room:bots', { remove: 'all' });
  await host.nextRoomWhere((x) => x.players.length === 1);
});

test('only the host can add bots, and only for games that have a bot.js', async () => {
  const { host, roomId } = await hostRoom();
  const guest = await client();
  guest.send('room:join', { roomId, password: 'pw', name: 'Guest' });
  await guest.next((m) => m.t === 'welcome');
  guest.send('room:bots', { add: 1 });
  assert.equal((await guest.next((m) => m.t === 'error')).code, 'not_host');

  host.send('room:config', { game: 'solo' });
  const r = await host.nextRoomWhere((x) => x.game.id === 'solo');
  assert.equal(r.botsSupported, false);
  host.send('room:bots', { add: 1 });
  assert.equal((await host.next((m) => m.t === 'error')).code, 'no_bots');
});

test('bot count is capped by free slots', async () => {
  const { host } = await hostRoom();
  host.send('room:bots', { add: 99 });
  const r = await host.roomWhere((x) => x.players.length === x.maxPlayers, 8000);
  assert.equal(r.players.filter((p) => p.bot).length, r.maxPlayers - 1);
  host.send('room:bots', { add: 1 });
  assert.equal((await host.next((m) => m.t === 'error')).code, 'room_full');
  host.send('room:bots', { remove: 'all' });
  await host.nextRoomWhere((x) => x.players.length === 1, 5000);
});

test('bot tickets are one-use, room-bound, and cannot be guessed', async () => {
  const { roomId } = await hostRoom();
  const tickets = srv.server.bots.tickets;
  tickets.set('known-ticket', { roomId, name: 'Sneaky (bot)', team: 'auto', expires: Date.now() + 10_000 });
  const a = await client();
  a.send('room:join', { roomId, botTicket: 'known-ticket' });
  await a.next((m) => m.t === 'welcome');
  const b = await client();
  b.send('room:join', { roomId, botTicket: 'known-ticket' });
  assert.equal((await b.next((m) => m.t === 'error')).code, 'bad_ticket', 'second use refused');
  const c = await client();
  c.send('room:join', { roomId, botTicket: 'made-up' });
  assert.equal((await c.next((m) => m.t === 'error')).code, 'bad_ticket');
  srv.server.manager.ipFailures.entries.clear();
});

test('the last human leaving closes the room and disconnects its bots', async () => {
  const { host, room } = await hostRoom();
  host.send('room:bots', { add: 2 });
  await host.roomWhere((x) => x.players.filter((p) => p.bot).length === 2, 5000);
  const r = room();
  const botSockets = [...r.players.values()].filter((p) => p.bot).map((p) => p.conn.ws);
  host.send('room:leave');
  await host.next((m) => m.t === 'left');
  await sleep(300);
  assert.equal(srv.server.manager.rooms.has(r.id), false);
  assert.ok(botSockets.every((ws) => ws.readyState >= 2), 'bot sockets closed');
});

test('bots are never made host', async () => {
  const { host, roomId } = await hostRoom();
  host.send('room:bots', { add: 2 });
  await host.roomWhere((x) => x.players.filter((p) => p.bot).length === 2, 5000);
  const guest = await client();
  guest.send('room:join', { roomId, password: 'pw', name: 'Guest' });
  const gw = await guest.next((m) => m.t === 'welcome');
  host.send('room:leave');
  const r = await guest.nextRoomWhere((x) => x.players.length === 3);
  assert.equal(r.hostId, gw.you);
});

test('an external program can join with code + password and play as a bot', async () => {
  const { host, roomId } = await hostRoom('dots', 'secret');
  const bad = new BotClient({ url: `ws://${srv.base}/ws`, join: { roomId, password: 'nope', name: 'Outsider', bot: true }, loadBrain: dotsBrain, log: { error() {}, debug() {} } });
  await assert.rejects(() => bad.start(), (err) => err.code === 'wrong_password');

  const bot = new BotClient({ url: `ws://${srv.base}/ws`, join: { roomId, password: 'secret', name: 'Outsider', bot: true }, loadBrain: dotsBrain, log: { error: console.error, debug() {} } });
  const w = await bot.start();
  assert.equal(w.room.players.find((p) => p.id === w.you).bot, true);
  host.send('room:start');
  await host.next((m) => m.t === 'match:start');
  const r = await host.roomWhere((x) => x.players.find((p) => p.id === w.you)?.inMatch, 5000);
  assert.ok(r);
  const st = () => srv.server.manager.rooms.get(roomId).match.hooks.debugState(w.you);
  await sleep(300);
  const start = [...st().pos];
  await sleep(1500);
  assert.ok(Math.hypot(st().pos[0] - start[0], st().pos[2] - start[2]) > 3, 'the bot moved on its own');
  bot.stop();
  host.send('room:end');
  await host.next((m) => m.t === 'match:end');
});

test('NavGrid finds a walkable route around a wall', () => {
  // A 20 x 20 floor with a wall down the middle. The only way through is a gap at the north end.
  const boxes = [
    { min: [-10, -1, -10], max: [10, 0, 10] },
    { min: [-1, 0, -10], max: [1, 3, 6] },
  ];
  const nav = new NavGrid(boxes, { bounds: { min: [-10, -1, -10], max: [10, 10, 10] }, cell: 0.5 });
  const from = [-6, 0, 0];
  const to = [6, 0, 0];
  const path = nav.findPath(from, to);
  assert.ok(path.length > 0);
  const last = path[path.length - 1];
  assert.ok(Math.hypot(last[0] - to[0], last[1] - to[2]) < 1);
  let prev = [from[0], from[2]];
  for (const wp of path) {
    assert.ok(nav.clearLine(prev, wp), 'every leg is walkable');
    prev = wp;
  }
  assert.ok(path.some((wp) => wp[1] > 6), 'goes through the gap');
  assert.equal(nav.floorAt(0, 0), 3, 'the wall top is a raised floor, too high to step onto');
});
