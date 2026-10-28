import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { startServer, TestClient, sleep } from './helpers.js';
import starter from '../templates/starter/server.js';

const SOURCE = 'gh:test/friendslop@' + '0'.repeat(40) + '/templates/starter';
const STARTER_META = (() => {
  const { create, ...rest } = JSON.parse(JSON.stringify(starter));
  return { ...rest, hasBot: false };
})();

/** A remote room whose match is running, with the host loaded in it (the host plays its runner by hand). */
async function remoteMatch(srv, opts) {
  const host = new TestClient(srv.base, opts);
  await host.connect();
  host.send('room:create', { name: 'Host', password: '', source: SOURCE, def: STARTER_META });
  await host.next((m) => m.t === 'welcome');
  host.send('room:start');
  await host.next((m) => m.t === 'match:start');
  host.send('match:ready');
  await host.waitFor((m) => m.t === 'relay:event' && m.ev === 'join');
  return host;
}

/** A world snapshot like a shooter's: 20 players whose numbers move a little each tick. */
function snapshot(tick) {
  const players = [];
  for (let i = 0; i < 20; i++) {
    players.push([`p_player${String(i).padStart(3, '0')}`, +(i * 3.1 + tick * 0.07).toFixed(2), 0, +(i * -2.3 + tick * 0.05).toFixed(2), +(tick * 0.01).toFixed(2), 0, 100, 1, i < 10 ? 'red' : 'blue', 3]);
  }
  return { t: 1_700_000_000_000 + tick * 66, players, points: ['A', 'B', 'C', 'D', 'E'].map((id) => ({ id, o: 'red', p: 1, x: 0 })) };
}

test('the server compresses what it sends and remembers recent messages', async () => {
  const srv = await startServer();
  const c = new TestClient(srv.base);
  try {
    await c.connect();
    assert.match(c.ws.extensions, /permessage-deflate/);
    // Without this the compressor forgets each message, and one snapshot can't be sent as
    // "the last one, a little different".
    assert.doesNotMatch(c.ws.extensions, /server_no_context_takeover/);
  } finally {
    c.close();
    await srv.close();
  }
});

test('the traffic meter counts the compressed bytes that leave the server', async () => {
  const srv = await startServer();
  const host = await remoteMatch(srv);
  try {
    const meter = srv.server.traffic;
    let text = 0;
    const before = meter.bytes;
    for (let tick = 0; tick < 60; tick++) {
      const data = snapshot(tick);
      text += JSON.stringify({ t: 'game', type: 'snap', data }).length;
      host.send('relay', { msgs: [{ k: 'out', to: 'all', type: 'snap', data }] });
    }
    const last = await host.waitFor((m) => m.t === 'game' && m.type === 'snap' && m.data.t === snapshot(59).t);
    assert.deepEqual(last.data, snapshot(59), 'messages arrive intact');
    await sleep(100);
    const wire = meter.bytes - before;
    assert.ok(wire > 0, 'sends are counted');
    assert.ok(wire < text * 0.3, `60 similar snapshots: ${text} bytes of text, ${wire} on the wire`);
  } finally {
    host.close();
    await srv.close();
  }
});

test('a client that does not offer compression still plays, and is counted in full', async () => {
  const srv = await startServer();
  const host = await remoteMatch(srv, { compress: false });
  try {
    assert.equal(host.ws.extensions, '');
    const meter = srv.server.traffic;
    // Nothing is compressed for this client, so the meter sees at least the text's size.
    const data = randomBytes(6000).toString('base64');
    const size = JSON.stringify({ t: 'game', type: 'noise', data }).length;
    const before = meter.bytes;
    host.send('relay', { msgs: [{ k: 'out', to: 'all', type: 'noise', data }] });
    const got = await host.waitFor((m) => m.t === 'game' && m.type === 'noise');
    assert.equal(got.data, data);
    await sleep(100);
    assert.ok(meter.bytes - before >= size, `${size} bytes of text, ${meter.bytes - before} counted`);
  } finally {
    host.close();
    await srv.close();
  }
});

// ---- packed messages: compression inside the app, for proxies that drop permessage-deflate ----

test('a client that asks for packed messages gets them, intact and small', async () => {
  const srv = await startServer();
  // Like a browser behind Render's proxy: no WebSocket compression, so the app packs instead.
  const host = await remoteMatch(srv, { compress: false, packed: true });
  try {
    assert.equal(host.ws.extensions, '');
    assert.ok(host.binaryFrames > 0, 'hello and the rest came packed');
    const meter = srv.server.traffic;
    let text = 0;
    const before = meter.bytes;
    for (let tick = 0; tick < 60; tick++) {
      const data = snapshot(tick);
      text += JSON.stringify({ t: 'game', type: 'snap', data }).length;
      host.send('relay', { msgs: [{ k: 'out', to: 'all', type: 'snap', data }] });
    }
    const last = await host.waitFor((m) => m.t === 'game' && m.type === 'snap' && m.data.t === snapshot(59).t);
    assert.deepEqual(last.data, snapshot(59), 'messages arrive intact');
    await sleep(100);
    const wire = meter.bytes - before;
    assert.ok(wire > 0, 'sends are counted');
    assert.ok(wire < text * 0.3, `60 similar snapshots: ${text} bytes of text, ${wire} on the wire`);
  } finally {
    host.close();
    await srv.close();
  }
});

test('packed messages keep their order', async () => {
  const srv = await startServer();
  const host = await remoteMatch(srv, { compress: false, packed: true });
  try {
    const got = [];
    const stop = host.onMessage((m) => { if (m.t === 'game' && m.type === 'n') got.push(m.data); });
    // Big and small, so some frames take zlib longer than others.
    for (let i = 0; i < 200; i++) {
      const pad = i % 7 === 0 ? randomBytes(3000).toString('base64') : '';
      host.send('relay', { msgs: [{ k: 'out', to: 'all', type: 'n', data: { i, pad } }] });
    }
    await host.waitFor((m) => m.t === 'game' && m.type === 'n' && m.data.i === 199, 5000);
    stop();
    assert.deepEqual(got.map((d) => d.i), [...Array(200).keys()]);
  } finally {
    host.close();
    await srv.close();
  }
});

test('packed messages skip the WebSocket compression a client also offered', async () => {
  const srv = await startServer();
  const host = await remoteMatch(srv, { compress: true, packed: true });
  try {
    assert.match(host.ws.extensions, /permessage-deflate/);
    host.send('relay', { msgs: [{ k: 'out', to: 'all', type: 'ok', data: { fine: true } }] });
    const got = await host.waitFor((m) => m.t === 'game' && m.type === 'ok');
    assert.deepEqual(got.data, { fine: true });
  } finally {
    host.close();
    await srv.close();
  }
});

test('the unpacker hands over every message pushed before the end, and stays quiet at the end', async () => {
  const { Packer } = await import('../server/packer.js');
  const { createUnpacker } = await import('../client/js/unpack.js');
  const packer = new Packer();
  const frames = await Promise.all(['one', 'two', 'three'].map((w) => new Promise((res) => packer.pack(JSON.stringify({ w }), res))));
  packer.close();
  const lines = [];
  const errors = [];
  const unpacker = createUnpacker((t) => lines.push(JSON.parse(t).w), (e) => errors.push(e));
  for (const f of frames) unpacker.push(f);
  await unpacker.end();
  assert.deepEqual(lines, ['one', 'two', 'three']);
  assert.deepEqual(errors, []);
});

test('a broken packed stream is reported', async () => {
  const { createUnpacker } = await import('../client/js/unpack.js');
  const errors = [];
  const unpacker = createUnpacker(() => {}, (e) => errors.push(e));
  unpacker.push(new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff]));
  await sleep(50);
  assert.equal(errors.length, 1);
});
