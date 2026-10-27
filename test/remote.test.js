import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer, TestClient } from './helpers.js';
import { defineGame } from '../server/kit/defineGame.js';
import starter from '../templates/starter/server.js';
import dots from './fixtures/games/dots/server.js';

const SOURCE = 'gh:test/friendslop@' + '0'.repeat(40) + '/templates/starter';

// Stands in for what describeGame(def, { hasBot }) will produce: everything defineGame
// returns except create, as JSON (so Infinity has become null), plus hasBot.
function metaOf(def, hasBot = false) {
  const { create, ...rest } = JSON.parse(JSON.stringify(def));
  return { ...rest, hasBot };
}
const starterMeta = () => metaOf(starter, false);

let srv;
let tmp;
const clients = [];

before(async () => {
  srv = await startServer();
});

after(async () => {
  for (const c of clients) c.close();
  await srv.close();
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

async function client(base = srv.base) {
  const c = new TestClient(base);
  clients.push(c);
  await c.connect();
  return c;
}

async function createRemote(def, source = SOURCE, base = srv.base) {
  const host = await client(base);
  host.send('room:create', { name: 'Host', password: '', source, def });
  const msg = await host.next((m) => m.t === 'welcome' || m.t === 'error');
  if (msg.t === 'error') host.close(); // keeps the run under the per-IP connection limit
  return { host, msg };
}

test('a room can be made from a GitHub source', async () => {
  const { msg } = await createRemote(starterMeta());
  assert.equal(msg.t, 'welcome');
  assert.equal(msg.room.game.source, SOURCE);
  assert.equal(msg.room.game.name, 'Starter');
  assert.equal(msg.room.maxPlayers, 12);
  assert.equal(msg.room.botsSupported, false);
});

test('botsSupported follows the definition, not the server games', async () => {
  const { msg } = await createRemote(metaOf(dots, true));
  assert.equal(msg.t, 'welcome');
  assert.equal(msg.room.botsSupported, true);
  assert.equal(msg.room.game.teams.length, 2);
  assert.equal(msg.room.game.settings.length, 2);
  // A server game of the same id has a bot brain; the remote room must not borrow it.
  const noBot = await createRemote(metaOf(dots, false));
  assert.equal(noBot.msg.room.botsSupported, false);
  const bots = await createRemote({ ...starterMeta(), hasBot: true });
  assert.equal(bots.msg.room.botsSupported, true);
});

test('rooms made from a server game have no source', async () => {
  const host = await client();
  host.send('room:create', { name: 'Host', password: '', game: 'dots' });
  const welcome = await host.next((m) => m.t === 'welcome');
  assert.equal(welcome.room.game.source, null);
});

test('a bad definition is refused with a reason', async () => {
  const meta = starterMeta();
  meta.teams = Array.from({ length: 9 }, (_, i) => ({ id: `t${i}`, name: `Team ${i}`, color: '#112233' }));
  const { msg } = await createRemote(meta);
  assert.equal(msg.t, 'error');
  assert.equal(msg.code, 'bad_source');
  assert.match(msg.message, /teams/);
});

test('definitions that are not plain JSON objects are refused', async () => {
  const cases = [undefined, null, 'starter', 7, [], { id: 'Bad Id' }, { ...starterMeta(), settings: 'x' }, { ...starterMeta(), controls: [['a']] }];
  for (const def of cases) {
    const { msg } = await createRemote(def);
    assert.equal(msg.t, 'error', JSON.stringify(def));
    assert.equal(msg.code, 'bad_source');
    assert.ok(msg.message);
  }
});

test('too many settings, columns or controls are refused', async () => {
  const setting = (i) => ({ key: `s${i}`, type: 'boolean', label: `S${i}`, default: false });
  const cases = [
    [{ settings: Array.from({ length: 33 }, (_, i) => setting(i)) }, /settings/],
    [{ scoreboard: Array.from({ length: 9 }, (_, i) => ({ key: `k${i}`, label: `K${i}` })) }, /scoreboard/],
    [{ controls: Array.from({ length: 17 }, (_, i) => [`K${i}`, 'x']) }, /controls/],
    [{ controls: [['K'.repeat(25), 'x']] }, /controls/],
    [{ controls: [['K', 'x'.repeat(41)]] }, /controls/],
  ];
  for (const [patch, re] of cases) {
    const { msg } = await createRemote({ ...starterMeta(), ...patch });
    assert.equal(msg.code, 'bad_source');
    assert.match(msg.message, re);
  }
});

test('names and descriptions are cleaned and cut short', async () => {
  const { msg } = await createRemote({ ...starterMeta(), name: `  ${'N'.repeat(60)}\u0007 `, description: 'D'.repeat(500) });
  assert.equal(msg.t, 'welcome');
  assert.equal(msg.room.game.name.length, 40);
  assert.equal(msg.room.game.description.length, 200);
});

test('a malformed source is refused', async () => {
  const { msg } = await createRemote(starterMeta(), 'gh:nope');
  assert.equal(msg.t, 'error');
  assert.equal(msg.code, 'bad_source');
});

test('a source that is not a string is refused', async () => {
  const { msg } = await createRemote(starterMeta(), { user: 'a' });
  assert.equal(msg.code, 'bad_source');
});

test('a blocked repo is refused', async () => {
  tmp = await mkdtemp(join(tmpdir(), 'remote-block-'));
  const file = join(tmp, 'blocklist.json');
  await writeFile(file, JSON.stringify({ repos: ['test/friendslop'] }));
  const blocked = await startServer({ BLOCKLIST: file });
  try {
    // The check runs before the definition is read, so even a broken one gets game_blocked.
    for (const def of [starterMeta(), null]) {
      const { msg } = await createRemote(def, SOURCE.replace('test/friendslop', 'Test/Friendslop'), blocked.base);
      assert.equal(msg.t, 'error');
      assert.equal(msg.code, 'game_blocked');
    }
    const other = await createRemote(starterMeta(), SOURCE.replace('friendslop', 'other'), blocked.base);
    assert.equal(other.msg.t, 'welcome');
  } finally {
    await blocked.close();
  }
});

test('settings from a remote definition are coerced by the server', async () => {
  const meta = metaOf(defineGame({
    id: 'target',
    settings: { target: { label: 'Target', min: 3, max: 100, default: 15 }, free: { default: 1 } },
    create() { return {}; },
  }));
  const { host, msg } = await createRemote(meta);
  assert.equal(msg.room.settings.target, 15);
  assert.equal(msg.room.game.settings.find((s) => s.key === 'free').max, null);
  host.send('room:config', { settings: { target: 999, free: 123456 } });
  const room = await host.nextRoomWhere((r) => r.settings.target === 100);
  assert.equal(room.settings.free, 123456);
  host.send('room:config', { settings: { target: -5 } });
  assert.equal((await host.nextRoomWhere((r) => r.settings.target === 3)).settings.target, 3);
});

test('a remote room cannot switch to a server game', async () => {
  const { host } = await createRemote(starterMeta());
  host.send('room:config', { game: 'dots' });
  const err = await host.next((m) => m.t === 'error');
  assert.equal(err.code, 'bad_request');
});

test('an untrusted definition cannot smuggle odd setting keys or values', async () => {
  const bad = [
    { key: '__proto__', type: 'boolean', label: 'x', default: true },
    { key: 'a', type: 'number', label: 'x', default: 'five' },
    { key: 'a', type: 'number', label: 'x', default: 5, min: 10, max: 1 },
    { key: 'a', type: 'select', label: 'x', default: 'q', options: [] },
    { key: 'a', type: 'select', label: 'x', default: 'q', options: [{ value: { deep: 1 }, label: 'x' }] },
    { key: 'a', type: 'wat', label: 'x', default: 1 },
  ];
  for (const s of bad) {
    const { msg } = await createRemote({ ...starterMeta(), settings: [s] });
    assert.equal(msg.code, 'bad_source', JSON.stringify(s));
  }
  const dup = { key: 'a', type: 'boolean', label: 'x', default: true };
  const { msg } = await createRemote({ ...starterMeta(), settings: [dup, dup] });
  assert.equal(msg.code, 'bad_source');
});

test('a scoreboard column without a label gets its key, cut to 24 characters', async () => {
  const key = 'k'.repeat(32);
  const { msg } = await createRemote({ ...starterMeta(), scoreboard: [{ key }, { key: 'wins', label: 'W‮ins' }] });
  assert.equal(msg.t, 'welcome');
  assert.equal(msg.room.game.scoreboard[0].key, key);
  assert.equal(msg.room.game.scoreboard[0].label, 'k'.repeat(24));
  assert.equal(msg.room.game.scoreboard[1].label, 'Wins');
});

test('scoreboard keys must be stat-key shaped and unique', async () => {
  for (const scoreboard of [[{ key: 'a b' }], [{ key: 'a‮b' }], [{ key: 'k'.repeat(33) }], [{ key: '' }], [{ key: 'a' }, { key: 'a', label: 'again' }]]) {
    const { msg } = await createRemote({ ...starterMeta(), scoreboard });
    assert.equal(msg.code, 'bad_source', JSON.stringify(scoreboard));
    assert.match(msg.message, /scoreboard/);
  }
});

test('a select option without a label gets its cleaned value, and long values are refused', async () => {
  const select = (options) => ({ key: 'mode', type: 'select', label: 'Mode', default: 'a', options });
  const ok = await createRemote({ ...starterMeta(), settings: [select(['a‮b' + 'z'.repeat(30), 7])] });
  assert.equal(ok.msg.t, 'welcome');
  const [first, second] = ok.msg.room.game.settings[0].options;
  assert.equal(first.label, 'ab' + 'z'.repeat(30));
  assert.equal(second.label, '7');
  for (const options of [['a'.repeat(41)], [{ value: 'a'.repeat(41), label: 'ok' }]]) {
    const { msg } = await createRemote({ ...starterMeta(), settings: [select(options)] });
    assert.equal(msg.code, 'bad_source');
    assert.match(msg.message, /option/);
  }
});
