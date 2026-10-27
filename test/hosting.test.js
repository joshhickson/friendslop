import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer, TestClient, sleep } from './helpers.js';
import { TrafficMeter } from '../server/traffic.js';
import { COPY } from '../shared/copy.js';
import starter from '../templates/starter/server.js';

function get(port, path, host) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, headers: { Host: host } }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function hostRoom(srv) {
  const host = new TestClient(srv.base);
  await host.connect();
  host.send('room:create', { name: 'Host', password: '', game: 'dots' });
  const w = await host.next((m) => m.t === 'welcome');
  return { host, roomId: w.room.id };
}

test('the total connection cap refuses extra players but not the server\'s own bots', async () => {
  const srv = await startServer({ MAX_CONNECTIONS: '1' });
  const { host } = await hostRoom(srv);
  try {
    await assert.rejects(() => new TestClient(srv.base).connect(), /HTTP 503/);
    host.send('room:bots', { add: 2 });
    await host.roomWhere((x) => x.players.filter((p) => p.bot).length === 2, 5000);
  } finally {
    host.close();
    await srv.close();
  }
});

test('an idle room closes and tells its players why; activity keeps a room open', async () => {
  const srv = await startServer({ ROOM_IDLE_MS: '400' });
  const idle = await hostRoom(srv);
  const busy = await hostRoom(srv);
  try {
    const poke = setInterval(() => busy.host.send('team:pick', { team: 'auto' }), 100);
    const left = await idle.host.next((m) => m.t === 'left', 3000);
    assert.equal(left.reason, 'idle');
    assert.equal(srv.server.manager.rooms.has(idle.roomId), false);
    await sleep(300);
    clearInterval(poke);
    assert.equal(srv.server.manager.rooms.has(busy.roomId), true, 'the busy room is still open');
  } finally {
    idle.host.close();
    busy.host.close();
    await srv.close();
  }
});

test('past the daily traffic budget, new rooms and matches are refused', async () => {
  const srv = await startServer({ DAILY_TRAFFIC_MB: '1' });
  const { host } = await hostRoom(srv);
  const other = new TestClient(srv.base);
  try {
    const meter = srv.server.traffic;
    assert.ok(meter.bytes > 0, 'messages to players are counted');
    meter.bytes = meter.budget;
    host.send('room:start');
    assert.equal((await host.next((m) => m.t === 'error')).code, 'traffic_budget');
    await other.connect();
    other.send('room:create', { name: 'Late', password: '' });
    assert.equal((await other.next((m) => m.t === 'error')).code, 'traffic_budget');
  } finally {
    host.close();
    other.close();
    await srv.close();
  }
});

test('the health check answers under any Host name; other pages still check it', async () => {
  const srv = await startServer({ DAILY_TRAFFIC_MB: '150' });
  try {
    const health = await get(srv.port, '/api/health', '10.0.0.5:10000');
    assert.equal(health.status, 200);
    const body = JSON.parse(health.body);
    assert.equal(body.ok, true);
    assert.equal(body.traffic.budgetMb, 150);
    assert.equal((await get(srv.port, '/', 'evil.example')).status, 403);
  } finally {
    await srv.close();
  }
});

test('the traffic meter starts again each UTC day', () => {
  let now = Date.parse('2026-10-26T23:59:00Z');
  const meter = new TrafficMeter({ dailyMb: 1, now: () => now });
  meter.add(2 * 1024 * 1024);
  assert.equal(meter.overBudget, true);
  now = Date.parse('2026-10-27T00:00:01Z');
  assert.equal(meter.overBudget, false);
  assert.equal(meter.stats().sentMb, 0);
  assert.equal(new TrafficMeter().overBudget, false, 'no budget means no limit');
});

// ---- a game from a GitHub source (the host's browser runs it; the test plays its runner by hand) ----

const SOURCE = 'gh:test/friendslop@' + '0'.repeat(40) + '/templates/starter';
const STARTER_META = (() => {
  const { create, ...rest } = JSON.parse(JSON.stringify(starter));
  return { ...rest, hasBot: false };
})();

/** A remote room whose match is running, with the host loaded in it. */
async function remoteMatch(srv) {
  const host = new TestClient(srv.base);
  await host.connect();
  host.send('room:create', { name: 'Host', password: '', source: SOURCE, def: STARTER_META });
  const w = await host.next((m) => m.t === 'welcome');
  host.send('room:start');
  await host.next((m) => m.t === 'match:start');
  host.send('match:ready');
  await host.waitFor((m) => m.t === 'relay:event' && m.ev === 'join');
  return { host, roomId: w.room.id };
}

const relayOut = (c, i) => c.send('relay', { msgs: [{ k: 'out', to: 'all', type: 'tick', data: i }] });

test('a host-run room with only relays still closes when its people go quiet', async () => {
  const srv = await startServer({ ROOM_IDLE_MS: '400' });
  const { host, roomId } = await remoteMatch(srv);
  let i = 0;
  const ticks = setInterval(() => relayOut(host, i++), 100);
  try {
    const left = await host.next((m) => m.t === 'left', 3000);
    assert.equal(left.reason, 'idle');
    assert.equal(srv.server.manager.rooms.has(roomId), false);
    assert.ok(i >= 3, 'relays were flowing');
  } finally {
    clearInterval(ticks);
    host.close();
    await srv.close();
  }
});

test('running matches go on past the daily budget, and end at 1.25 times it', async () => {
  const srv = await startServer({ DAILY_TRAFFIC_MB: '1' });
  const local = await hostRoom(srv);
  const remote = await remoteMatch(srv);
  try {
    local.host.send('room:start');
    await local.host.next((m) => m.t === 'match:start');
    local.host.send('match:ready');
    const meter = srv.server.traffic;
    meter.bytes = meter.budget;
    relayOut(remote.host, 1);
    await remote.host.next((m) => m.t === 'game' && m.type === 'tick');
    await sleep(100);
    assert.equal(srv.server.manager.rooms.get(local.roomId).phase, 'playing', 'over the budget, a running match goes on');
    assert.equal(srv.server.manager.rooms.get(remote.roomId).phase, 'playing');
    meter.bytes = meter.budget * 1.25 - 10;
    const localEnd = local.host.next((m) => m.t === 'match:end');
    const remoteEnd = remote.host.next((m) => m.t === 'match:end');
    relayOut(remote.host, 2);
    for (const end of [await localEnd, await remoteEnd]) {
      assert.equal(end.result.text, COPY.dataBudgetEnded);
      assert.equal(end.result.error, true);
    }
    assert.equal(srv.server.manager.rooms.get(local.roomId).phase, 'lobby');
    assert.equal(srv.server.manager.rooms.get(remote.roomId).phase, 'lobby');
  } finally {
    local.host.close();
    remote.host.close();
    await srv.close();
  }
});
