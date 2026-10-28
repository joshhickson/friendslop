// The Chaos Circle: four nested hypocycloid rings (3, 4, 5 and 6 cusps), 10 tiles each, with Babel in the
// middle. Geometry from the original board renderer (joshhickson/reality_check, public/board-render.js).

import { RINGS, TILES } from '../shared/content.js';

const NS = 'http://www.w3.org/2000/svg';
const INK = '#22201c';
const PANEL = '#f3f1ea';
const TILE_COUNT = 10;
const RADII = { career: 134, health: 112, social: 90, personal: 66 };
const SPIN = { career: -126, health: 147, social: 129, personal: 147 };   // degrees, searched so no two tiles overlap
const ICON = { sin: '☠', virtue: '✝', chaos: '?', bonus: '★' };
const ANCHOR = { career: '$', health: '+', social: '♥', personal: '☼' };

function el(tag, attrs = {}, text) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Points along a hypocycloid with `cusps` cusps and outer radius R, rotated by `spin` degrees. */
function curve(R, cusps, spin, steps = 900) {
  const r = R / cusps;
  const a = (spin * Math.PI) / 180;
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = (Math.PI * 2 * i) / steps;
    const x = (R - r) * Math.cos(t) + r * Math.cos(((R - r) / r) * t);
    const y = (R - r) * Math.sin(t) - r * Math.sin(((R - r) / r) * t);
    pts.push([x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]);
  }
  return pts;
}

/** `count` points spaced evenly by arc length, starting at the first point (a cusp). */
function evenly(pts, count) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = cum[cum.length - 1];
  const out = [];
  let j = 0;
  for (let k = 0; k < count; k++) {
    const target = (total * k) / count;
    while (cum[j + 1] < target) j++;
    out.push(pts[j]);
  }
  return out;
}

export function createBoard(container) {
  const svg = el('svg', { viewBox: '-150 -150 300 300', class: 'rc-board' });
  const tiles = {};   // ringId -> [[x, y]]
  const tileEls = {}; // ringId -> [circle]

  svg.append(el('circle', { cx: 2, cy: 2, r: 146, fill: INK }));
  svg.append(el('circle', { cx: 0, cy: 0, r: 146, fill: PANEL, stroke: INK, 'stroke-width': 2 }));

  const rings = el('g');
  const tileLayer = el('g');
  for (const ring of RINGS) {
    const pts = curve(RADII[ring.id], ring.cusps, SPIN[ring.id]);
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('') + 'Z';
    const g = el('g', { class: `rc-ring rc-ring-${ring.id}` });
    g.append(el('path', { d, fill: 'none', stroke: INK, 'stroke-width': 5, 'stroke-linejoin': 'round', opacity: 0.85 }));
    g.append(el('path', { d, fill: 'none', stroke: ring.color, 'stroke-width': 3, 'stroke-linejoin': 'round' }));
    rings.append(g);

    tiles[ring.id] = evenly(pts, TILE_COUNT);
    tileEls[ring.id] = tiles[ring.id].map(([x, y], i) => {
      const kind = TILES[ring.id][i];
      const t = el('g', { class: `rc-tile rc-tile-${kind}`, transform: `translate(${x.toFixed(1)} ${y.toFixed(1)})` });
      if (kind === 'anchor') {
        t.append(el('rect', { x: -7, y: -7, width: 14, height: 14, rx: 3, fill: ring.color, stroke: INK, 'stroke-width': 2 }));
        t.append(el('text', { class: 'rc-tile-icon', y: 3.2, fill: '#fff' }, ANCHOR[ring.id]));
      } else {
        t.append(el('circle', { r: 5.4, fill: PANEL, stroke: ring.color, 'stroke-width': 2.4 }));
        t.append(el('text', { class: 'rc-tile-icon', y: 2.4, fill: INK }, ICON[kind]));
      }
      tileLayer.append(t);
      return t;
    });
  }
  svg.append(rings, tileLayer);

  // Babel, in the middle: a clock that counts down to the next town-wide event.
  const babel = el('g', { class: 'rc-babel' });
  babel.append(el('circle', { r: 22, fill: '#7b4bc4', stroke: INK, 'stroke-width': 2.5 }));
  const babelArc = el('path', { fill: 'none', stroke: '#f3f1ea', 'stroke-width': 3.2, 'stroke-linecap': 'round' });
  babel.append(babelArc);
  babel.append(el('text', { class: 'rc-babel-label', y: -3 }, 'BABEL'));
  const babelNum = el('text', { class: 'rc-babel-num', y: 9 }, '');
  babel.append(babelNum);
  svg.append(babel);

  const tokens = el('g');
  svg.append(tokens);
  container.append(svg);

  const tokenEls = new Map();   // playerId -> { g, at: [ring, idx] }
  let anim = null;
  let lastMove = null;

  function tokenFor(id, color, label) {
    let t = tokenEls.get(id);
    if (!t) {
      const g = el('g', { class: 'rc-token' });
      g.append(el('circle', { r: 7.5, cx: 1, cy: 1, fill: INK }));
      g.append(el('circle', { class: 'rc-token-body', r: 7.5, fill: color, stroke: INK, 'stroke-width': 1.8 }));
      g.append(el('text', { class: 'rc-token-label', y: 3 }, label));
      tokens.append(g);
      t = { g, at: null };
      tokenEls.set(id, t);
    }
    return t;
  }

  function place(t, ring, idx, slot, of) {
    const [x, y] = tiles[ring][idx];
    const spread = of > 1 ? 7 : 0;
    const a = (slot / Math.max(1, of)) * Math.PI * 2 - Math.PI / 2;
    t.g.setAttribute('transform', `translate(${(x + Math.cos(a) * spread).toFixed(1)} ${(y + Math.sin(a) * spread).toFixed(1)})`);
    t.at = [ring, idx];
  }

  /** players: [{ id, ring, idx, present, color, label, me, current }], move: the latest move or null */
  function update(players, move, moverId, babelIn, babelEvery) {
    // Share a tile between everyone standing on it.
    const groups = new Map();
    for (const p of players) {
      if (!p.present) continue;
      const k = `${p.ring}:${p.idx}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(p.id);
    }
    const seen = new Set();
    for (const p of players) {
      const t = tokenFor(p.id, p.color, p.label);
      seen.add(p.id);
      t.g.style.display = p.present ? '' : 'none';
      t.g.classList.toggle('me', p.me);
      t.g.classList.toggle('current', p.current);
      const group = groups.get(`${p.ring}:${p.idx}`) ?? [p.id];
      const animating = anim && anim.id === p.id;
      if (!animating) place(t, p.ring, p.idx, group.indexOf(p.id), group.length);
    }
    for (const [id, t] of tokenEls) if (!seen.has(id)) { t.g.remove(); tokenEls.delete(id); }

    // Walk the mover's token one tile at a time, the first time we see a move.
    const key = move && moverId ? `${moverId}:${move.ring}:${move.from}:${move.roll}` : null;
    if (key && key !== lastMove) {
      lastMove = key;
      const t = tokenEls.get(moverId);
      if (t) {
        clearInterval(anim?.timer);
        let step = 0;
        place(t, move.ring, move.from, 0, 1);
        anim = { id: moverId, timer: setInterval(() => {
          step++;
          place(t, move.ring, (move.from + step) % TILE_COUNT, 0, 1);
          if (step >= move.roll) {
            clearInterval(anim.timer);
            anim = null;
            update(players, move, moverId, babelIn, babelEvery);
          }
        }, 190) };
      }
    }

    // Light up the ring in play.
    for (const g of rings.children) g.classList.toggle('active', Boolean(move && g.classList.contains(`rc-ring-${move.ring}`)));
    for (const [ring, list] of Object.entries(tileEls)) {
      list.forEach((t, i) => t.classList.toggle('landed', Boolean(move && move.ring === ring && move.to === i)));
    }

    // Babel clock: the arc fills as the next event gets closer.
    const frac = babelEvery > 0 ? 1 - babelIn / babelEvery : 0;
    const a = Math.max(0.001, Math.min(0.999, frac)) * Math.PI * 2;
    const R = 17;
    babelArc.setAttribute('d', `M0 ${-R}A${R} ${R} 0 ${a > Math.PI ? 1 : 0} 1 ${(Math.sin(a) * R).toFixed(2)} ${(-Math.cos(a) * R).toFixed(2)}`);
    babelNum.textContent = babelIn <= 0 ? 'NOW' : `${babelIn}`;
  }

  return {
    update,
    pulseBabel() {
      babel.classList.remove('pulse');
      void babel.getBBox();
      babel.classList.add('pulse');
    },
    destroy() {
      clearInterval(anim?.timer);
      svg.remove();
    },
  };
}
