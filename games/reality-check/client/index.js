// Reality Check, browser side: the Chaos Circle board on the left, and on the right whose turn it is,
// the card in play, everyone's stats and the town log. Everything comes from the server's `state`.

import { defineClientGame, sfx, h, replace } from '/client/kit/index.js';
import { createBoard } from './board.js';
import { RINGS, TRAITS } from '../shared/content.js';
import { fxText, money, scoreOf, JUDGMENT, MENTAL_MAX } from '../shared/rules.js';

// friendslop's Blockout look: light panels with ink edges and hard offset shadows, an orange accent.
const INK = '#22201c';
const PANEL = '#f3f1ea';
const BG = '#c9c7be';
const ACCENT = '#f28c28';
const GOOD = '#2f8f4e';
const BAD = '#d93a2b';
const PURPLE = '#7b4bc4';
const COLORS = ['#d93a2b', '#2e5bd8', '#2f8f4e', '#e8b923', '#7b4bc4', '#f28c28', '#1f9aa0', '#d6458f'];
const DECK = {
  sin: { name: 'Sin', icon: '☠', color: INK },
  virtue: { name: 'Virtue', icon: '✝', color: '#2e5bd8' },
  chaos: { name: 'Chaos', icon: '?', color: PURPLE },
};
const RING = Object.fromEntries(RINGS.map((r) => [r.id, r]));
const TRAIT = Object.fromEntries(TRAITS.map((t) => [t.id, t]));
const DIE = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

const CSS = `
.rc { position:absolute; inset:0; display:grid; grid-template-columns:minmax(0,1fr) minmax(340px,430px); background:${BG};
  font-family:"Bricolage Grotesque",system-ui,sans-serif; color:${INK}; overflow:hidden; }
.rc * { box-sizing:border-box; }
.rc-left { position:relative; display:flex; flex-direction:column; min-height:0; padding:14px; }
.rc-top { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
.rc-chip { background:${PANEL}; border:3px solid ${INK}; border-radius:10px; box-shadow:3px 3px 0 ${INK}; padding:4px 10px; font-weight:800; font-size:14px; }
.rc-chip.big { font:400 18px/1.2 Bungee,system-ui,sans-serif; }
.rc-chip.babel { background:${PURPLE}; color:#fff; }
.rc-boardwrap { flex:1; min-height:0; display:flex; align-items:center; justify-content:center; padding:10px 0 34px; }
.rc-board { width:100%; height:100%; max-height:100%; overflow:visible; }
.rc-ring path { transition:opacity .3s; }
.rc-ring.active path:last-child { stroke-width:5; }
.rc-tile-icon { font:800 7px "Bricolage Grotesque",system-ui,sans-serif; text-anchor:middle; pointer-events:none; }
.rc-tile-anchor .rc-tile-icon { font:800 9px "Bricolage Grotesque",system-ui,sans-serif; }
.rc-tile.landed circle, .rc-tile.landed rect { stroke:${ACCENT}; stroke-width:4; }
.rc-babel-label { font:400 7px Bungee,system-ui,sans-serif; fill:#fff; text-anchor:middle; }
.rc-babel-num { font:400 10px Bungee,system-ui,sans-serif; fill:#fff; text-anchor:middle; }
.rc-babel.pulse { animation:rcpulse .6s ease-out 3; transform-origin:center; transform-box:fill-box; }
@keyframes rcpulse { 50% { transform:scale(1.25); } }
.rc-token { transition:transform .18s ease-out; }
.rc-token-label { font:400 7px Bungee,system-ui,sans-serif; fill:#fff; text-anchor:middle; pointer-events:none; }
.rc-token.me .rc-token-body { stroke:${ACCENT}; stroke-width:2.6; }
.rc-token.current { animation:rcbob 1s ease-in-out infinite; }
@keyframes rcbob { 50% { opacity:.65; } }

.rc-side { min-height:0; overflow-y:auto; padding:14px 14px 40px 4px; display:flex; flex-direction:column; gap:12px; }
.rc-panel { background:${PANEL}; border:3px solid ${INK}; border-radius:12px; box-shadow:4px 4px 0 ${INK}; padding:12px 14px; }
.rc-h { font:400 20px/1.15 Bungee,system-ui,sans-serif; margin:0 0 6px; }
.rc-sub { font-size:14px; font-weight:600; opacity:.8; margin:0 0 8px; }
.rc-timer { height:8px; border:2px solid ${INK}; border-radius:5px; background:#e6e3d9; overflow:hidden; margin:2px 0 10px; }
.rc-timer div { height:100%; background:${ACCENT}; }
.rc-btn { display:block; width:100%; text-align:left; font:inherit; color:${INK}; background:#fff; border:3px solid ${INK}; border-radius:10px;
  box-shadow:3px 3px 0 ${INK}; padding:8px 10px; margin:0 0 8px; cursor:pointer; }
.rc-btn:hover:not(:disabled) { transform:translate(-1px,-1px); box-shadow:4px 4px 0 ${INK}; }
.rc-btn:active:not(:disabled) { transform:translate(2px,2px); box-shadow:1px 1px 0 ${INK}; }
.rc-btn:disabled { cursor:default; opacity:.55; }
.rc-btn .k { float:right; font:800 11px "Bricolage Grotesque",system-ui,sans-serif; border:1.5px solid ${INK}; border-radius:5px; padding:0 5px; background:${PANEL}; }
.rc-btn b { font-size:16px; }
.rc-btn .fx { display:block; font-size:13px; font-weight:700; margin-top:2px; }
.rc-btn .fx.dim { opacity:.7; font-weight:600; }
.rc-ringbtn { border-left-width:12px; }
.rc-card { border:3px solid ${INK}; border-radius:12px; overflow:hidden; margin-bottom:10px; background:#fff; }
.rc-card-head { color:#fff; padding:6px 10px; display:flex; justify-content:space-between; align-items:center; font:400 13px Bungee,system-ui,sans-serif; }
.rc-card-head .ring { font:800 11px "Bricolage Grotesque",system-ui,sans-serif; background:${PANEL}; color:${INK}; border-radius:6px; padding:1px 7px; border:2px solid ${INK}; }
.rc-card-body { padding:10px 12px 12px; }
.rc-card-title { font:400 22px/1.1 Bungee,system-ui,sans-serif; margin:0 0 6px; }
.rc-card-text { font-size:15px; font-weight:600; margin:0; }
.rc-note { font-size:14px; font-weight:600; border-left:4px solid ${ACCENT}; padding:2px 0 2px 8px; margin:0 0 8px; }
.rc-lines { display:flex; flex-direction:column; gap:4px; margin-top:8px; font-size:14px; font-weight:700; }
.rc-lines .pos { color:${GOOD}; }
.rc-lines .neg { color:${BAD}; }
.rc-die { font-size:40px; line-height:1; float:right; margin-left:8px; }
.rc-players { display:flex; flex-direction:column; gap:8px; }
.rc-p { background:${PANEL}; border:3px solid ${INK}; border-radius:12px; box-shadow:3px 3px 0 ${INK}; padding:8px 10px; position:relative; }
.rc-p.current { box-shadow:0 0 0 3px ${ACCENT}, 4px 4px 0 3px ${INK}; }
.rc-p.gone { opacity:.5; }
.rc-p-top { display:flex; align-items:center; gap:8px; }
.rc-dot { width:18px; height:18px; border-radius:50%; border:2px solid ${INK}; flex:none; }
.rc-p-name { font-weight:800; font-size:16px; flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.rc-p-score { font:400 18px Bungee,system-ui,sans-serif; }
.rc-p-who { font-size:12px; font-weight:600; opacity:.75; margin:2px 0 4px; }
.rc-stats { display:grid; grid-template-columns:auto 1fr auto auto; gap:2px 10px; align-items:center; font-size:14px; font-weight:800; }
.rc-mind { display:flex; gap:2px; }
.rc-mind i { flex:1; height:9px; border:1.5px solid ${INK}; border-radius:2px; background:#e6e3d9; }
.rc-mind i.on { background:${GOOD}; }
.rc-mind.low i.on { background:${BAD}; }
.rc-tag { display:inline-block; font-size:11px; font-weight:800; border:2px solid ${INK}; border-radius:6px; padding:0 5px; margin-left:4px; background:#fff; }
.rc-log { font-size:13px; font-weight:600; display:flex; flex-direction:column; gap:4px; max-height:260px; overflow-y:auto; }
.rc-log div { border-left:4px solid #a8a49a; padding-left:7px; }
.rc-log .sin { border-color:${INK}; } .rc-log .virtue { border-color:#2e5bd8; } .rc-log .chaos { border-color:${PURPLE}; }
.rc-log .babel { border-color:${PURPLE}; background:#ece4f8; } .rc-log .bad { border-color:${BAD}; } .rc-log .good { border-color:${GOOD}; }
.rc-final { position:absolute; inset:0; background:rgba(34,32,28,.55); display:flex; align-items:center; justify-content:center; padding:16px; z-index:3; }
.rc-final .rc-panel { width:min(720px,100%); max-height:100%; overflow-y:auto; }
.rc-final h1 { font:400 34px/1.05 Bungee,system-ui,sans-serif; margin:0 0 4px; }
.rc-row { display:grid; grid-template-columns:32px 1fr auto; gap:10px; align-items:center; border-top:2px dashed #a8a49a; padding:8px 0; }
.rc-row .pl { font:400 22px Bungee,system-ui,sans-serif; }
.rc-row .nm { font-weight:800; font-size:17px; }
.rc-row .bk { font-size:12px; font-weight:600; opacity:.8; }
.rc-row .tot { font:400 26px Bungee,system-ui,sans-serif; text-align:right; }
.rc-judg { display:inline-block; font:400 12px Bungee,system-ui,sans-serif; border:2px solid ${INK}; border-radius:6px; padding:1px 6px; margin-left:6px; }
.rc-judg.heaven { background:#fff7d1; } .rc-judg.purgatory { background:#e6e3d9; } .rc-judg.hell { background:${BAD}; color:#fff; }
.rc-titles { display:flex; flex-wrap:wrap; gap:6px; margin:6px 0 4px; }
@media (max-width: 820px) {
  .rc { grid-template-columns:1fr; grid-template-rows:max-content max-content; overflow-y:auto; }
  .rc-left { padding:10px; min-height:auto; }
  .rc-boardwrap { height:min(42vh, 92vw); flex:none; padding:6px 0; }
  .rc-side { overflow:visible; padding:0 10px 60px; }
}
`;

const signed = (n) => (n > 0 ? `+${n}` : `${n}`);

export default defineClientGame({
  teamPicker: false,
  mount(api) {
    api.ui.showHint(false);
    const style = h('style', CSS);
    const rounds = h('div.rc-chip.big');
    const babelChip = h('div.rc-chip.babel');
    const youChip = h('div.rc-chip');
    const boardWrap = h('div.rc-boardwrap');
    const left = h('div.rc-left', h('div.rc-top', rounds, babelChip, youChip), boardWrap);
    const action = h('div.rc-panel.interactive');
    const players = h('div.rc-players');
    const logBox = h('div.rc-log');
    const side = h('div.rc-side', action, players, h('div.rc-panel', h('div.rc-h', { style: { fontSize: '15px' } }, 'Babel Daily'), logBox));
    const finalBox = h('div');
    const root = h('div.rc', style, left, side, finalBox);
    api.root.append(root);
    const board = createBoard(boardWrap);

    let st = null;
    let lastKey = '';
    let lastFinal = null;
    let returnAt = 0;
    const timerBar = h('div');
    let raf = 0;

    const colorOf = (id) => {
      const i = st ? st.order.indexOf(id) : -1;
      return COLORS[(i < 0 ? 0 : i) % COLORS.length];
    };
    const nameOf = (id) => st?.players.find((p) => p.id === id)?.name ?? api.player(id)?.name ?? '?';
    const isMyTurn = () => st && st.cur === api.me && !api.spectating;

    function send(type, data) {
      sfx.play('click');
      api.send(type, data);
    }

    // ---------- the action panel ----------

    function timer() {
      return h('div.rc-timer', timerBar);
    }

    function notes() {
      return (st.notes ?? []).map((n) => h('p.rc-note', `${n.text} ${fxText(n.fx) ? `(${fxText(n.fx)})` : ''}`));
    }

    function fxLines(lines) {
      return h('div.rc-lines', (lines ?? []).map((l) => {
        const t = fxText(l.fx);
        const good = (l.fx.money ?? 0) + (l.fx.mental ?? 0) * 500 + (l.fx.virtue ?? 0) * 800 - (l.fx.sin ?? 0) * 800;
        return h(`div.${good >= 0 ? 'pos' : 'neg'}`, `${l.id === api.me ? 'You' : nameOf(l.id)}${l.text ? ` (${l.text})` : ''}: ${t || 'no change'}`);
      }));
    }

    function choiceFx(c) {
      const parts = [];
      if (c.roll) {
        let prev = 0;
        for (const o of c.roll) {
          parts.push(h('span.fx.dim', `Roll ${prev + 1 === o.upTo ? o.upTo : `${prev + 1}-${o.upTo}`}: ${fxText(o.fx) || 'nothing'}`));
          prev = o.upTo;
        }
      } else {
        parts.push(h('span.fx', fxText(c.fx ?? {}) || 'Nothing happens'));
      }
      if (c.later) parts.push(h('span.fx.dim', `In ${c.later.in} turns: ${fxText(c.later.fx)}`));
      if (c.others) parts.push(h('span.fx.dim', `Everyone else: ${fxText(c.others)}`));
      if (!c.ok && c.cost) parts.push(h('span.fx', { style: { color: BAD } }, `You need ${money(c.cost)}`));
      return parts;
    }

    function renderAction() {
      const mine = isMyTurn();
      const who = st.cur ? (st.cur === api.me ? 'You' : nameOf(st.cur)) : '';
      switch (st.phase) {
        case 'intro': {
          const me = st.players.find((p) => p.id === api.me);
          return replace(action,
            h('div.rc-h', 'Welcome to Babel'),
            h('p.rc-sub', 'The birth lottery has spoken. Nobody chose where they started.'),
            timer(),
            me ? [
              h('p.rc-card-text', `You are ${/^[AEIOU]/.test(me.bg) ? 'an' : 'a'} ${me.bg} with ${money(me.money)} and a mind at ${me.mental}/${MENTAL_MAX}.`),
              h('p.rc-note', { style: { marginTop: '8px' } }, `${TRAIT[me.trait]?.name}: ${TRAIT[me.trait]?.text}`),
            ] : h('p.rc-card-text', 'You are watching. Pick a side of the moral spectrum to root for.'),
            h('p.rc-sub', { style: { marginTop: '8px' } }, `${st.rounds} rounds. Each turn, pick a ring to focus on, roll, and live with it. Most points at Judgment Day wins.`));
        }
        case 'pick':
          return replace(action,
            h('div.rc-h', mine ? 'Your turn' : `${who}'s turn`),
            h('p.rc-sub', mine ? 'Where do you focus your life this turn? You roll a die and move on that ring.' : `${who} is choosing a ring...`),
            timer(),
            notes(),
            RINGS.map((r, i) => h('button.rc-btn.rc-ringbtn', {
              style: { borderLeftColor: r.color },
              disabled: !mine,
              onclick: () => send('ring', { ring: r.id }),
            }, h('span.k', String(i + 1)), h('b', r.name), h('span.fx.dim', r.blurb))));
        case 'card': {
          const c = st.card;
          const deck = DECK[c.deck];
          const lap = st.result?.lines?.filter((l) => l.text) ?? [];
          return replace(action,
            h('div.rc-h', mine ? 'Your move' : `${who} drew a card`),
            timer(),
            lap.length ? fxLines(lap) : null,
            st.move ? h('p.rc-sub', `Rolled ${st.move.roll} on ${RING[st.move.ring].name}.`) : null,
            h('div.rc-card',
              h('div.rc-card-head', { style: { background: deck.color } }, h('span', `${deck.icon} ${deck.name}`), h('span.ring', RING[c.ring].name)),
              h('div.rc-card-body', h('div.rc-card-title', c.title), h('p.rc-card-text', c.text))),
            c.choices.map((ch, i) => h('button.rc-btn', {
              disabled: !mine || !ch.ok,
              onclick: () => send('choice', { i }),
            }, h('span.k', String(i + 1)), h('b', ch.label), choiceFx(ch))),
            mine ? null : h('p.rc-sub', `Waiting for ${who} to decide...`));
        }
        case 'reveal': {
          const r = st.result ?? {};
          return replace(action,
            h('div.rc-h', r.title || 'Result'),
            r.roll ? h('div.rc-die', DIE[r.roll]) : null,
            st.move ? h('p.rc-sub', `${who} rolled ${st.move.roll} on ${RING[st.move.ring].name}.`) : null,
            r.choice ? h('p.rc-note', `${who} chose "${r.choice}"`) : null,
            r.text ? h('p.rc-card-text', r.text) : null,
            fxLines(r.lines),
            mine ? h('button.rc-btn', { style: { marginTop: '10px', textAlign: 'center' }, onclick: () => send('next', { turn: st.turn }) }, h('b', 'Continue'), h('span.k', 'Space')) : null);
        }
        case 'babel': {
          const b = st.babel;
          return replace(action,
            h('div.rc-card',
              h('div.rc-card-head', { style: { background: PURPLE } }, h('span', 'Babel event'), h('span.ring', 'Everyone')),
              h('div.rc-card-body', h('div.rc-card-title', b.title), h('p.rc-card-text', b.text), fxLines(b.lines))),
            timer());
        }
        case 'over':
          return replace(action, h('div.rc-h', 'Judgment Day'), h('p.rc-sub', 'The final scores are in.'));
      }
    }

    // ---------- players, log, top bar ----------

    function renderPlayers() {
      replace(players, st.order.map((id) => {
        const p = st.players.find((x) => x.id === id);
        if (!p) return null;
        const bits = [];
        if (p.skip) bits.push(h('span.rc-tag', 'hospital'));
        if (p.pending) bits.push(h('span.rc-tag', { title: 'Choices that will come back around' }, `${p.pending} pending`));
        if (!p.present) bits.push(h('span.rc-tag', 'left'));
        if (api.player(id)?.bot) bits.push(h('span.rc-tag', 'bot'));
        const mind = h(`div.rc-mind${p.mental <= 3 ? '.low' : ''}`, Array.from({ length: MENTAL_MAX }, (_, i) => h(`i${i < p.mental ? '.on' : ''}`)));
        return h(`div.rc-p${st.cur === id ? '.current' : ''}${p.present ? '' : '.gone'}`,
          h('div.rc-p-top', h('div.rc-dot', { style: { background: colorOf(id) } }), h('div.rc-p-name', id === api.me ? `${p.name} (you)` : p.name), bits, h('div.rc-p-score', String(p.score))),
          h('div.rc-p-who', { title: TRAIT[p.trait]?.text ?? '' }, `${p.bg} · ${TRAIT[p.trait]?.name ?? ''}`),
          h('div.rc-stats',
            h('span', { style: { color: p.money < 0 ? BAD : INK } }, money(p.money)),
            mind,
            h('span', { title: 'Sin' }, `☠ ${p.sin}`),
            h('span', { title: 'Virtue' }, `✝ ${p.virtue}`)));
      }));
    }

    function renderLog() {
      replace(logBox, [...st.log].reverse().map((l) => h(`div.${l.kind}`, l.text)));
    }

    function babelIn() {
      return (st.babelEvery - (st.round % st.babelEvery)) % st.babelEvery;
    }

    function renderTop() {
      rounds.textContent = st.phase === 'over' ? 'Judgment Day' : `Round ${Math.min(st.round, st.rounds)} / ${st.rounds}`;
      const at = st.round + babelIn();
      babelChip.textContent = st.phase === 'babel' ? 'Babel event!' : at === st.round ? 'Babel event after this round' : `Babel event after round ${at}`;
      babelChip.style.display = st.phase === 'over' || (at > st.rounds && st.phase !== 'babel') ? 'none' : '';
      const me = st.players.find((p) => p.id === api.me);
      youChip.textContent = me ? `Score now: ${scoreOf({ ...me, minMental: me.mental }).total}` : 'Spectating';
      youChip.style.display = me ? '' : 'none';
    }

    // ---------- Judgment Day ----------

    function renderFinal() {
      const f = st.final;
      if (!f || f === lastFinal) return;
      lastFinal = f;
      const titles = [['saint', 'The Saint'], ['hustler', 'The Hustler'], ['survivor', 'The Survivor'], ['sinner', 'Most Sinful']]
        .filter(([k]) => f.titles[k]).map(([k, label]) => h('span.rc-chip', `${label}: ${nameOf(f.titles[k])}`));
      const countdown = h('p.rc-sub', '');
      replace(finalBox, h('div.rc-final.interactive', h('div.rc-panel',
        h('h1', 'Judgment Day'),
        h('p.rc-sub', 'Points: 1 per $1,000 (up to $20,000), half a point per Mind, +1 per Virtue, -1 per Sin. Saint +5 (Sin under 3, Virtue over 8). Hustler +5 (end with $20,000 or more). Fortitude +3 (Mind never below 6).'),
        h('div.rc-titles', titles),
        f.standings.map((s, i) => h('div.rc-row',
          h('div.pl', String(i + 1)),
          h('div',
            h('div.nm', h('span.rc-dot', { style: { display: 'inline-block', verticalAlign: 'middle', marginRight: '6px', background: colorOf(s.id) } }), s.id === api.me ? `${s.name} (you)` : s.name,
              h(`span.rc-judg.${s.judgment}`, JUDGMENT[s.judgment].name)),
            h('div.bk', `${s.bg}. ${money(s.money)}, Mind ${s.mental}, ☠ ${s.sin}, ✝ ${s.virtue}${s.score.saint ? ', Saint +5' : ''}${s.score.hustler ? ', Hustler +5' : ''}${s.score.fortitude ? ', Fortitude +3' : ''}. ${JUDGMENT[s.judgment].text}`)),
          h('div.tot', String(s.score.total)))),
        countdown)));
      const tick = () => {
        if (!returnAt || !countdown.isConnected) return;
        const s = Math.max(0, Math.ceil((returnAt - api.serverNow()) / 1000));
        countdown.textContent = `Back to the lobby in ${s}s.`;
      };
      tick();
      finalBox.tick = tick;
    }

    function render() {
      renderTop();
      renderAction();
      renderPlayers();
      renderLog();
      renderFinal();
      board.update(
        st.players.map((p) => ({ ...p, color: colorOf(p.id), label: (p.name || '?')[0].toUpperCase(), me: p.id === api.me, current: p.id === st.cur })),
        st.phase === 'card' || st.phase === 'reveal' ? st.move : null,
        st.cur,
        babelIn(),
        st.babelEvery,
      );
    }

    api.on('state', (s) => {
      const prev = st;
      st = s;
      const key = `${s.turn}:${s.phase}`;
      if (key !== lastKey) {
        lastKey = key;
        if (s.phase === 'pick' && s.cur === api.me) sfx.play('pickup');
        if (s.phase === 'babel') { sfx.play('alarm'); board.pulseBabel(); }
        if (s.phase === 'reveal' && prev) {
          const mine = s.result?.lines?.find((l) => l.id === api.me && !l.text);
          if (mine) sfx.play((mine.fx.money ?? 0) + (mine.fx.mental ?? 0) * 500 >= 0 ? 'score' : 'hurt');
        }
      }
      render();
    });
    api.onRoom(() => { if (st) renderPlayers(); });
    api.onMatchEnd((r) => { returnAt = r.returnAt ?? 0; });

    function frame() {
      raf = requestAnimationFrame(frame);
      if (!st) return;
      if (st.deadline && timerBar.isConnected) {
        const total = st.phase === 'intro' ? 6000 : st.phase === 'babel' ? 7000 : (api.settings?.turnSeconds ?? 30) * 1000;
        const left = Math.max(0, st.deadline - api.serverNow());
        timerBar.style.width = `${Math.min(100, (left / total) * 100)}%`;
      }
      finalBox.tick?.();
    }
    frame();

    function onKey(e) {
      if (!st || api.ui.isBlocking() || !isMyTurn()) return;
      const n = Number(e.key);
      if (st.phase === 'pick' && n >= 1 && n <= RINGS.length) send('ring', { ring: RINGS[n - 1].id });
      else if (st.phase === 'card' && n >= 1 && n <= st.card.choices.length && st.card.choices[n - 1].ok) send('choice', { i: n - 1 });
      else if (st.phase === 'reveal' && e.key === ' ') { e.preventDefault(); send('next', { turn: st.turn }); }
    }
    window.addEventListener('keydown', onKey);

    return {
      destroy() {
        cancelAnimationFrame(raf);
        window.removeEventListener('keydown', onKey);
        board.destroy();
        root.remove();
      },
    };
  },
});
