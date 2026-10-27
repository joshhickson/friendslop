import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, TestClient } from './helpers.js';

const TEMPLATES = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates');

test('with no games the server still starts, and creating a room says there is no game', async () => {
  const empty = await mkdtemp(join(tmpdir(), 'friendslop-empty-'));
  const srv = await startServer({ GAMES_DIR: empty });
  const c = new TestClient(srv.base);
  try {
    await c.connect();
    assert.deepEqual(c.messages[0].games, []);
    c.send('room:create', { name: 'Host', password: '' });
    assert.equal((await c.next((m) => m.t === 'error')).code, 'unknown_game');
  } finally {
    c.close();
    await srv.close();
    await rm(empty, { recursive: true, force: true });
  }
});

test('the starter template loads as a game, runs, and takes bots', async () => {
  const srv = await startServer({ GAMES_DIR: TEMPLATES });
  const host = new TestClient(srv.base);
  try {
    await host.connect();
    assert.deepEqual(host.messages[0].games.map((g) => g.id), ['starter']);
    host.send('room:create', { name: 'Host', password: '' });
    const w = await host.next((m) => m.t === 'welcome');
    assert.equal(w.room.botsSupported, true);
    host.send('room:bots', { add: 1 });
    await host.roomWhere((x) => x.players.some((p) => p.bot), 5000);
    host.send('room:start');
    await host.next((m) => m.t === 'match:start');
    host.send('match:ready');
    const state = await host.next((m) => m.t === 'game' && m.type === 'state' && m.data.players.length === 2, 5000);
    assert.equal(state.data.size, 40);
    host.send('room:end');
    await host.next((m) => m.t === 'match:end');
  } finally {
    host.close();
    await srv.close();
  }
});
