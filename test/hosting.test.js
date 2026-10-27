import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer, TestClient, sleep } from './helpers.js';
import { TrafficMeter } from '../server/traffic.js';

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
