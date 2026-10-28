// Reality Check: a satirical board game about modern adult life, set in the town of Babel.
// Each turn you pick a ring of the Chaos Circle to focus on (Career, Health, Social or Personal), roll,
// and deal with what you land on: a Sin card, a Virtue card, a Chaos card or a small life event.
// Every few rounds a Babel event hits the whole town. After the last round comes Judgment Day.
//
// Turn-based, so there's no simulation: every change is followed by a full `state` broadcast.
// Shared by a GitHub link, this file runs in the host's browser. Relative imports only.

import { defineGame } from '../../server/kit/index.js';
import { RINGS, TILES, LAP_BONUS, BONUS, SIN, VIRTUE, CHAOS, BABEL_EVENTS, BACKGROUNDS, TRAITS } from './shared/content.js';
import { traitFx, applyFx, scoreOf, judgmentOf, affordable, fxText, money, BREAKDOWN_BILL, BREAKDOWN_RESET, JUDGMENT } from './shared/rules.js';

const RING_IDS = RINGS.map((r) => r.id);
const TILE_COUNT = 10;
const INTRO_MS = 6000;
const REVEAL_MS = 3800;
const BABEL_MS = 7000;
const AWAY_MS = 1200;    // how long the game waits on a player who left before acting for them
const LOG_SIZE = 40;

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const d6 = () => 1 + Math.floor(Math.random() * 6);
const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/** A deck that deals every card once before reshuffling, preferring cards from the ring asked for. */
function makeDeck(cards) {
  let pile = shuffle(cards);
  return {
    draw(ring) {
      if (pile.length === 0) pile = shuffle(cards);
      let i = pile.findIndex((c) => c.ring === ring);
      if (i < 0) i = 0;
      return pile.splice(i, 1)[0];
    },
  };
}

export default defineGame({
  id: 'reality-check',
  name: 'Reality Check',
  description: 'The game of modern survival, sin and satire. Pick a ring, roll, and live with your choices until Judgment Day.',
  minPlayers: 1,
  maxPlayers: 6,
  tickRate: 5,
  joinInProgress: true,
  resultsSeconds: 30,

  settings: {
    rounds: { label: 'Rounds', default: 8, min: 1, max: 15 },
    turnSeconds: { label: 'Seconds to decide', default: 30, min: 10, max: 120, step: 5 },
    babelEvery: { label: 'Babel event every N rounds', default: 3, min: 1, max: 10 },
  },

  scoreboard: [
    { key: 'money', label: 'Money' },
    { key: 'mind', label: 'Mind' },
    { key: 'sin', label: 'Sin' },
    { key: 'virtue', label: 'Virtue' },
    { key: 'score', label: 'Score' },
  ],

  controls: [['Click', 'choose'], ['1-4', 'pick a ring or choice'], ['Space', 'continue']],

  create(ctx) {
    const s = ctx.settings;
    const decks = { sin: makeDeck(SIN), virtue: makeDeck(VIRTUE), chaos: makeDeck(CHAOS) };
    const babelDeck = makeDeck(BABEL_EVENTS);
    const bonusDecks = Object.fromEntries(RING_IDS.map((r) => [r, makeDeck(BONUS[r])]));
    const bgDeck = makeDeck(BACKGROUNDS);
    const traitDeck = makeDeck(TRAITS);

    const recs = new Map();   // playerId -> record (kept after a player leaves, for the final standings)
    const order = [];         // turn order, player ids
    const log = [];
    const statCache = new Map();

    const g = {
      phase: 'intro',         // intro | pick | card | reveal | babel | over
      round: 1,
      cur: 0,                 // index into order
      turn: 0,                // counts every turn, so bots and clients can tell turns apart
      deadline: ctx.now() + INTRO_MS,
      notes: [],              // start-of-turn happenings for the current player
      move: null,             // { ring, from, to, roll }
      card: null,           // { deck, ring, ...card }
      result: null,           // { title, text, lines: [{ id, fx }] }
      babel: null,
      final: null,
    };

    const curId = () => order[g.cur];
    const nameOf = (id) => ctx.getPlayer(id)?.name ?? recs.get(id)?.name ?? 'Someone';

    function addLog(text, kind = 'info') {
      log.push({ text, kind, round: g.round });
      if (log.length > LOG_SIZE) log.shift();
    }

    function newRecord(player) {
      const bg = bgDeck.draw();
      const trait = traitDeck.draw();
      const mental = Math.max(1, Math.min(10, bg.mental + Math.floor(Math.random() * 3) - 1));
      return {
        id: player.id,
        name: player.name,
        bg: bg.id,
        bgName: bg.name,
        trait: trait.id,
        money: bg.money + Math.round((Math.random() * 2000 - 1000) / 100) * 100,
        mental,
        minMental: mental,
        sin: bg.sin,
        virtue: bg.virtue,
        ring: pick(RING_IDS),
        idx: 0,
        turns: 0,
        skip: false,
        later: [],
        present: true,
        breakdowns: 0,
      };
    }

    // Apply an effect to a player and handle a breakdown. Returns the change actually made.
    function hit(rec, rawFx, source, card = false) {
      const delta = applyFx(rec, traitFx(rawFx, rec.trait, source, card));
      if (rec.mental <= 0) {
        rec.breakdowns++;
        applyFx(rec, { money: -BREAKDOWN_BILL });
        rec.mental = BREAKDOWN_RESET;
        rec.skip = true;
        delta.money -= BREAKDOWN_BILL;
        addLog(`${rec.name} had a breakdown: ${money(BREAKDOWN_BILL)} hospital bill, and they miss a turn.`, 'bad');
      }
      rec.minMental = Math.min(rec.minMental, rec.mental);
      return delta;
    }

    function syncStats() {
      for (const rec of recs.values()) {
        const player = ctx.getPlayer(rec.id);
        if (!player) continue;
        const values = { money: money(rec.money), mind: rec.mental, sin: rec.sin, virtue: rec.virtue, score: scoreOf(rec).total };
        for (const [k, v] of Object.entries(values)) {
          const key = `${rec.id}:${k}`;
          if (statCache.get(key) === v) continue;
          statCache.set(key, v);
          ctx.setStat(player, k, v);
        }
      }
    }

    function view() {
      return {
        phase: g.phase,
        round: g.round,
        rounds: s.rounds,
        babelEvery: s.babelEvery,
        turn: g.turn,
        cur: g.phase === 'intro' || g.phase === 'babel' || g.phase === 'over' ? null : curId() ?? null,
        deadline: g.deadline,
        notes: g.notes,
        move: g.move,
        card: g.card && {
          deck: g.card.deck,
          ring: g.card.ring,
          id: g.card.id,
          title: g.card.title,
          text: g.card.text,
          choices: g.card.choices.map((c) => ({
            label: c.label,
            fx: c.fx ?? null,
            roll: c.roll ?? null,
            later: c.later ? { in: c.later.in, fx: c.later.fx } : null,
            others: c.others ?? null,
            cost: c.cost ?? 0,
            ok: affordable(c, recs.get(curId())),
          })),
        },
        result: g.result,
        babel: g.babel,
        final: g.final,
        order,
        players: [...recs.values()].map((r) => ({
          id: r.id,
          name: r.name,
          bg: r.bgName,
          trait: r.trait,
          money: r.money,
          mental: r.mental,
          sin: r.sin,
          virtue: r.virtue,
          ring: r.ring,
          idx: r.idx,
          skip: r.skip,
          pending: r.later.length,
          present: r.present,
          score: scoreOf(r).total,
        })),
        log,
      };
    }

    function push() {
      syncStats();
      ctx.broadcast('state', view());
    }

    // ---------- turn flow ----------

    function beginTurn() {
      // Skip seats whose player left; the game ends their story where it stopped.
      while (g.cur < order.length && !recs.get(order[g.cur]).present) g.cur++;
      if (g.cur >= order.length) return endRound();

      const rec = recs.get(curId());
      g.turn++;
      g.notes = [];
      g.move = null;
      g.card = null;
      g.result = null;

      for (const l of rec.later.filter((x) => x.due <= rec.turns)) {
        rec.later.splice(rec.later.indexOf(l), 1);
        const fx = hit(rec, l.fx, l.ring, true);
        g.notes.push({ text: l.text, fx });
        addLog(`${rec.name}: ${l.text} (${fxText(fx)})`, fx.money < 0 || fx.mental < 0 ? 'bad' : 'good');
      }
      if (rec.money < 0 && !rec.skip) {
        const fx = hit(rec, { mental: -1 }, 'debt');
        g.notes.push({ text: 'Debt collectors called again. Your stomach hurts.', fx });
      }

      if (rec.skip) {
        rec.skip = false;
        rec.turns++;
        g.phase = 'reveal';
        g.result = { title: 'In the Hospital', text: `${rec.name} is recovering from a breakdown and sits this turn out.`, kind: 'bad', lines: [] };
        g.deadline = ctx.now() + REVEAL_MS;
        return push();
      }

      g.phase = 'pick';
      g.deadline = ctx.now() + (rec.present ? s.turnSeconds * 1000 : AWAY_MS);
      push();
    }

    function pickRing(ringId) {
      const rec = recs.get(curId());
      const roll = d6();
      const from = rec.idx;
      const to = (from + roll) % TILE_COUNT;
      rec.ring = ringId;
      rec.idx = to;
      g.move = { ring: ringId, from, to, roll };
      const ringName = RINGS.find((r) => r.id === ringId).name;
      const lines = [];

      if (from + roll >= TILE_COUNT) {
        const lap = LAP_BONUS[ringId];
        const fx = hit(rec, lap.fx, ringId);
        lines.push({ id: rec.id, fx, text: lap.title });
        addLog(`${rec.name} lapped the ${ringName} ring: ${lap.title} (${fxText(fx)})`, 'good');
      }

      const tile = TILES[ringId][to];
      if (tile === 'anchor' || tile === 'bonus') {
        const ev = tile === 'anchor' ? LAP_BONUS[ringId] : bonusDecks[ringId].draw();
        if (tile === 'bonus') {
          const fx = hit(rec, ev.fx, ringId);
          lines.push({ id: rec.id, fx, text: ev.title });
          addLog(`${rec.name} rolled ${roll} on ${ringName}: ${ev.title} (${fxText(fx)})`);
        }
        return reveal({ title: ev.title, text: ev.text, kind: 'event', lines });
      }

      const card = decks[tile].draw(ringId);
      g.card = { ...card, deck: tile, ring: ringId };
      g.result = lines.length ? { title: '', text: '', lines } : null;
      g.phase = 'card';
      g.deadline = ctx.now() + (rec.present ? s.turnSeconds * 1000 : AWAY_MS);
      push();
    }

    function choose(i) {
      const rec = recs.get(curId());
      const card = g.card;
      const choice = card.choices[i];
      const lines = g.result?.lines ?? [];
      let text = '';
      let roll = null;

      if (choice.roll) {
        roll = d6();
        const outcome = choice.roll.find((o) => roll <= o.upTo) ?? choice.roll[choice.roll.length - 1];
        text = outcome.text;
        lines.push({ id: rec.id, fx: hit(rec, outcome.fx, card.ring, true) });
      } else {
        lines.push({ id: rec.id, fx: hit(rec, choice.fx, card.ring, true) });
      }
      if (choice.later) rec.later.push({ due: rec.turns + choice.later.in, fx: choice.later.fx, text: choice.later.text, ring: card.ring });
      if (choice.others) {
        for (const other of recs.values()) {
          if (other.id === rec.id || !other.present) continue;
          lines.push({ id: other.id, fx: hit(other, choice.others, card.ring) });
        }
      }

      const mine = lines.find((l) => l.id === rec.id && !l.text)?.fx ?? {};
      const kind = card.deck === 'chaos' ? 'chaos' : (mine.sin > 0 ? 'sin' : mine.virtue > 0 ? 'virtue' : 'info');
      addLog(`${rec.name} drew ${card.title} and chose "${choice.label}"${roll ? `, rolled ${roll}` : ''} (${fxText(mine) || 'nothing happens'})`, kind);
      reveal({ title: card.title, choice: choice.label, roll, text: text || (choice.later ? 'This will come back around in a few turns.' : ''), kind, lines });
    }

    function reveal(result) {
      g.result = result;
      g.phase = 'reveal';
      g.deadline = ctx.now() + REVEAL_MS;
      push();
    }

    function endTurn() {
      const rec = recs.get(curId());
      if (rec) rec.turns++;
      g.cur++;
      beginTurn();
    }

    function endRound() {
      if (g.round % s.babelEvery === 0 && g.phase !== 'babel') return babelEvent();
      g.round++;
      if (g.round > s.rounds) return finish();
      g.cur = 0;
      beginTurn();
    }

    function babelEvent() {
      const ev = babelDeck.draw();
      const live = [...recs.values()].filter((r) => r.present);
      const byMoney = [...live].sort((a, b) => b.money - a.money);
      const lines = [];
      for (const rec of live) {
        const fx = { ...(ev.fx ?? {}) };
        if (ev.moneyPct && rec.money > 0) fx.money = (fx.money ?? 0) + Math.round((rec.money * ev.moneyPct) / 100) * 100;
        const extra = (rec === byMoney[0] && live.length > 1 && ev.richest) || (rec === byMoney[byMoney.length - 1] && live.length > 1 && ev.poorest);
        if (extra) for (const [k, v] of Object.entries(extra)) fx[k] = (fx[k] ?? 0) + v;
        lines.push({ id: rec.id, fx: hit(rec, fx, 'babel') });
      }
      g.babel = { title: ev.title, text: ev.text, lines };
      g.phase = 'babel';
      g.card = null;
      g.move = null;
      g.deadline = ctx.now() + BABEL_MS;
      addLog(`Babel event: ${ev.title}`, 'babel');
      ctx.announce(`Babel event: ${ev.title}`);
      push();
    }

    function finish() {
      const standings = [...recs.values()]
        .map((r) => ({ id: r.id, name: r.name, bg: r.bgName, trait: r.trait, money: r.money, mental: r.mental, sin: r.sin, virtue: r.virtue, present: r.present, score: scoreOf(r), judgment: judgmentOf(r) }))
        .sort((a, b) => b.score.total - a.score.total);
      const best = (key) => {
        const top = [...standings].sort((a, b) => b[key] - a[key])[0];
        return top && top[key] > 0 ? top.id : null;
      };
      g.final = { standings, titles: { saint: best('virtue'), sinner: best('sin'), hustler: best('money'), survivor: best('mental') } };
      g.phase = 'over';
      g.deadline = 0;
      g.card = null;
      g.result = null;
      g.babel = null;
      const winner = standings[0];
      push();
      ctx.endMatch(
        winner
          ? { winner: winner.id, text: `Judgment Day: ${winner.score.total} points, bound for ${JUDGMENT[winner.judgment].name}.` }
          : { text: 'Nobody survived Babel.' },
      );
    }

    // What happens when the clock runs out (or for a player who left).
    function timeout() {
      switch (g.phase) {
        case 'intro': g.cur = 0; return beginTurn();
        case 'pick': return pickRing(pick(RING_IDS));
        case 'card': {
          // The last choice you can afford is the cautious one ("walk away").
          const rec = recs.get(curId());
          const i = g.card.choices.map((c, j) => (affordable(c, rec) ? j : -1)).filter((j) => j >= 0).pop() ?? 0;
          return choose(i);
        }
        case 'reveal': return endTurn();
        case 'babel': return endRound();
      }
    }

    return {
      onPlayerJoin(player) {
        let rec = recs.get(player.id);
        if (!rec) {
          rec = newRecord(player);
          recs.set(player.id, rec);
          order.push(player.id);
          if (g.phase === 'intro' && recs.size === 1) g.deadline = ctx.now() + INTRO_MS;
          if (g.phase !== 'intro') addLog(`${player.name} moved to Babel as a ${rec.bgName}.`);
        }
        rec.present = true;
        rec.name = player.name;
        push();
      },

      onPlayerLeave(player) {
        const rec = recs.get(player.id);
        if (!rec) return;
        rec.present = false;
        if (curId() === player.id && (g.phase === 'pick' || g.phase === 'card')) g.deadline = Math.min(g.deadline, ctx.now() + AWAY_MS);
        push();
      },

      onSpectatorJoin(player) {
        ctx.send(player, 'state', view());
      },

      onMessage(player, type, data) {
        if (player.id !== curId() || !data || typeof data !== 'object') return;
        if (type === 'ring' && g.phase === 'pick' && RING_IDS.includes(data.ring)) pickRing(data.ring);
        else if (type === 'choice' && g.phase === 'card' && Number.isInteger(data.i)) {
          const c = g.card.choices[data.i];
          if (c && affordable(c, recs.get(player.id))) choose(data.i);
        } else if (type === 'next' && g.phase === 'reveal' && data.turn === g.turn) endTurn();
      },

      tick() {
        if (g.phase === 'over' || ctx.phase === 'results') return;
        if (g.phase === 'intro' && recs.size === 0) return;
        if (ctx.now() >= g.deadline) timeout();
      },
    };
  },
});
