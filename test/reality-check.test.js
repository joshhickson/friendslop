import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import game from '../games/reality-check/server.js';
import { coerceSettings } from '../server/kit/defineGame.js';
import { scoreOf, judgmentOf, traitFx, applyFx } from '../games/reality-check/shared/rules.js';
import { SIN, VIRTUE, CHAOS } from '../games/reality-check/shared/content.js';
import { startServer, TestClient } from './helpers.js';

const GAMES = join(fileURLToPath(new URL('..', import.meta.url)), 'games');

/** Runs Reality Check's create() against a fake ctx with a clock the test moves by hand. */
function harness(settings = {}, names = ['Ann', 'Bo', 'Cy']) {
  let now = 1000;
  const players = names.map((name, i) => ({ id: `p${i}`, name, connected: true }));
  const out = { states: [], stats: new Map(), ended: null, announced: [] };
  const ctx = {
    settings: coerceSettings(game.settings, settings),
    phase: 'playing',
    now: () => now,
    players: () => players.filter((p) => p.connected),
    getPlayer: (id) => players.find((p) => p.id === id) ?? null,
    broadcast: (type, data) => { if (type === 'state') out.states.push(structuredClone(data)); },
    send: () => {},
    setStat: (p, k, v) => out.stats.set(`${p.id}:${k}`, v),
    announce: (t) => out.announced.push(t),
    endMatch: (r) => { out.ended = r; ctx.phase = 'results'; },
  };
  const hooks = game.create(ctx);
  for (const p of players) hooks.onPlayerJoin(p);
  const last = () => out.states[out.states.length - 1];
  return {
    hooks, players, out, last,
    advance(ms) { now += ms; hooks.tick(0.2); },
    /** Plays until the match ends, letting `act` answer for each turn (or the clock run out). */
    play(act = () => {}, limit = 5000) {
      for (let i = 0; i < limit && !out.ended; i++) {
        const s = last();
        if (s.cur && (s.phase === 'pick' || s.phase === 'card' || s.phase === 'reveal')) act(s, players.find((p) => p.id === s.cur));
        if (last() === s) this.advance(500);
      }
    },
  };
}

test('reality check: a full game ends on Judgment Day with sane numbers', () => {
  const hz = harness({ rounds: 4, babelEvery: 2 });
  hz.play((s, p) => {
    if (s.phase === 'pick') hz.hooks.onMessage(p, 'ring', { ring: ['career', 'health', 'social', 'personal'][s.turn % 4] });
    else if (s.phase === 'card') hz.hooks.onMessage(p, 'choice', { i: s.card.choices.findIndex((c) => c.ok) });
    else hz.hooks.onMessage(p, 'next', { turn: s.turn });
  });
  assert.ok(hz.out.ended, 'the match ended');
  const final = hz.last().final;
  assert.equal(final.standings.length, 3);
  assert.equal(hz.out.ended.winner, final.standings[0].id);
  for (const s of final.standings) {
    for (const k of ['money', 'mental', 'sin', 'virtue']) assert.ok(Number.isFinite(s[k]), `${k} is a number`);
    assert.ok(s.mental >= 0 && s.mental <= 10);
    assert.ok(s.sin >= 0 && s.virtue >= 0);
    assert.ok(['heaven', 'purgatory', 'hell'].includes(s.judgment));
  }
  assert.equal(hz.out.announced.length, 2, 'a Babel event after rounds 2 and 4');
  assert.equal(hz.out.stats.get('p0:score'), final.standings.find((s) => s.id === 'p0').score.total);
  // Each player had one turn per round (none of them were in hospital long enough to change that much).
  const turns = new Set(hz.out.states.map((s) => s.turn)).size;
  assert.ok(turns >= 4 * 3 - 3, `about 12 turns were played (${turns})`);
});

test('reality check: the clock plays for anyone who does nothing', () => {
  const hz = harness({ rounds: 2, turnSeconds: 10 });
  hz.play();
  assert.ok(hz.out.ended);
  assert.ok(hz.out.states.some((s) => s.phase === 'card' || s.result?.lines?.length));
});

test('reality check: only the current player acts, and only on choices they can afford', () => {
  const hz = harness({ rounds: 1 });
  while (hz.last().phase !== 'pick') hz.advance(500);
  const s = hz.last();
  const other = hz.players.find((p) => p.id !== s.cur);
  const me = hz.players.find((p) => p.id === s.cur);
  hz.hooks.onMessage(other, 'ring', { ring: 'career' });
  assert.equal(hz.last().phase, 'pick', 'another player cannot move for them');
  hz.hooks.onMessage(me, 'ring', { ring: 'the moon' });
  assert.equal(hz.last().phase, 'pick', 'rings are checked');
  hz.hooks.onMessage(me, 'ring', { ring: 'health' });
  assert.notEqual(hz.last().phase, 'pick');
  assert.equal(hz.last().move.ring, 'health');
  if (hz.last().phase === 'card') {
    hz.hooks.onMessage(me, 'choice', { i: 99 });
    hz.hooks.onMessage(me, 'choice', { i: '0' });
    assert.equal(hz.last().phase, 'card', 'bad choices are ignored');
  }
});

test('reality check: a player who leaves on their turn is played for, and stays in the standings', () => {
  const hz = harness({ rounds: 2 });
  while (hz.last().phase !== 'pick') hz.advance(500);
  const leaver = hz.players.find((p) => p.id === hz.last().cur);
  leaver.connected = false;
  hz.hooks.onPlayerLeave(leaver);
  hz.advance(1500);
  assert.notEqual(hz.last().cur === leaver.id && hz.last().phase === 'pick', true, 'their turn moved on');
  hz.play();
  assert.ok(hz.out.ended);
  assert.equal(hz.last().final.standings.length, 3);
});

test('reality check: scoring, judgment and traits', () => {
  assert.equal(scoreOf({ money: 50000, mental: 10, sin: 0, virtue: 10, minMental: 8 }).total, 20 + 5 + 10 + 5 + 3 + 5);
  assert.equal(scoreOf({ money: -3000, mental: 4, sin: 6, virtue: 1, minMental: 2 }).total, -3 + 2 + 1 - 6);
  assert.equal(judgmentOf({ sin: 0, virtue: 5 }), 'heaven');
  assert.equal(judgmentOf({ sin: 7, virtue: 2 }), 'hell');
  assert.equal(judgmentOf({ sin: 3, virtue: 3 }), 'purgatory');
  assert.deepEqual(traitFx({ money: 2000, mental: 1 }, 'career_junkie', 'career'), { money: 3000, mental: 0, sin: 0, virtue: 0 });
  assert.deepEqual(traitFx({ mental: -2 }, 'fragile', 'health'), { money: 0, mental: -4, sin: 0, virtue: 0 });
  assert.deepEqual(traitFx({ money: 1000 }, 'zen', 'personal', true), { money: 750, mental: 0, sin: 0, virtue: 1 });
  assert.deepEqual(traitFx({ money: -800 }, 'crisis_magnet', 'babel'), { money: -1600, mental: 0, sin: 0, virtue: 0 });
  const p = { money: 0, mental: 9, sin: 1, virtue: 0 };
  assert.deepEqual(applyFx(p, { mental: 5, sin: -4 }), { money: 0, mental: 1, sin: -1, virtue: 0 });
});

test('reality check: every card is well formed', () => {
  const rings = new Set(['career', 'health', 'social', 'personal']);
  for (const card of [...SIN, ...VIRTUE, ...CHAOS]) {
    assert.ok(rings.has(card.ring), `${card.id} has a ring`);
    assert.ok(card.title && card.text && card.choices.length >= 1, `${card.id} has text and choices`);
    for (const c of card.choices) {
      assert.ok(c.label, `${card.id} choice has a label`);
      assert.ok(c.fx || c.roll, `${card.id} choice "${c.label}" has an effect`);
      if (c.roll) assert.equal(c.roll[c.roll.length - 1].upTo, 6, `${card.id} rolls cover 1-6`);
    }
    assert.ok(card.choices.some((c) => !c.cost), `${card.id} has a choice anyone can take`);
  }
});

test('reality check: loads on a real server and plays with bots', async () => {
  const srv = await startServer({ GAMES_DIR: GAMES });
  const host = new TestClient(srv.base);
  try {
    await host.connect();
    host.send('room:create', { name: 'Host', password: '' });
    await host.next((m) => m.t === 'welcome');
    host.send('room:config', { game: 'reality-check', settings: { rounds: 1 } });
    await host.roomWhere((r) => r.game.id === 'reality-check');
    host.send('room:bots', { add: 2 });
    await host.roomWhere((r) => r.players.filter((p) => p.bot).length === 2, 5000);
    host.send('room:start');
    await host.next((m) => m.t === 'match:start');
    host.send('match:ready');
    const intro = await host.next((m) => m.t === 'game' && m.data.phase === 'intro' && m.data.players.length === 3, 5000);
    assert.equal(intro.data.order.length, 3);
    // The host plays its own turns; the bots have to play theirs.
    const me = intro.data.players.find((p) => p.name === 'Host').id;
    const stop = host.onMessage((m) => {
      if (m.t !== 'game' || m.data.cur !== me) return;
      if (m.data.phase === 'pick') host.game('ring', { ring: 'social' });
      else if (m.data.phase === 'card') host.game('choice', { i: m.data.card.choices.findIndex((c) => c.ok) });
      else if (m.data.phase === 'reveal') host.game('next', { turn: m.data.turn });
    });
    const bots = new Set(intro.data.order.filter((id) => id !== me));
    const played = new Set();
    await host.next((m) => {
      if (m.t === 'game' && bots.has(m.data.cur) && m.data.phase === 'reveal') played.add(m.data.cur);
      return played.size === 2;
    }, 30000);
    stop();
    host.send('room:end');
    await host.next((m) => m.t === 'match:end');
  } finally {
    host.close();
    await srv.close();
  }
});
