// Grid pathfinding over a box world, for bots or any AI that walks around a level.
//
//   const nav = new NavGrid(MAP.boxes, { bounds: MAP.bounds, cell: 0.5 });
//   const path = nav.findPath(from, to);   // [[x, z], ...] waypoints, or [] if unreachable
//
// The level is treated as a heightfield: each cell's floor is the top of the highest box under
// its center, so raised platforms, ledges and stairs work. A move between neighbouring cells is
// allowed if it climbs no more than a step (stepHeight) or drops no more than `maxDrop`.
// Limitation: no walkable surface may sit above another (no bridges or tunnels); build levels from
// boxes that stand on the ground. Paths are smoothed so bots don't zig-zag along cells.

import { DEFAULT_BODY, collides } from './physics.js';

const SQRT2 = Math.SQRT2;

export class NavGrid {
  /**
   * @param {Array<{min: number[], max: number[]}>} boxes solid AABBs (include the floor)
   * @param {object} opts
   * @param {{min: number[], max: number[]}} opts.bounds  area to cover (x/z used)
   * @param {number} [opts.cell=0.5]   cell size in world units
   * @param {object} [opts.body]       character body { radius, height, stepHeight }
   * @param {number} [opts.margin=0.1] extra clearance kept from obstacles
   * @param {number} [opts.maxDrop=3]  highest ledge a path may drop off
   */
  constructor(boxes, { bounds, cell = 0.5, body = DEFAULT_BODY, margin = 0.1, maxDrop = 3, from = null } = {}) {
    if (from) {
      // Copy constructor (used by withBlocked): share the floor heights, copy walkability.
      for (const k of ['cell', 'step', 'maxDrop', 'minX', 'minZ', 'w', 'h', 'floor']) this[k] = from[k];
      this.walkable = from.walkable.slice();
      this.#allocScratch();
      return;
    }
    this.cell = cell;
    this.step = body.stepHeight + 1e-3;
    this.maxDrop = maxDrop;
    this.minX = bounds.min[0];
    this.minZ = bounds.min[2];
    this.w = Math.ceil((bounds.max[0] - bounds.min[0]) / cell);
    this.h = Math.ceil((bounds.max[2] - bounds.min[2]) / cell);
    const n = this.w * this.h;
    this.floor = new Float32Array(n).fill(-Infinity);
    this.walkable = new Uint8Array(n);
    // Anything rising more than a step above the floor within this radius blocks the cell.
    const probe = { radius: body.radius + margin, height: body.height - body.stepHeight };
    for (let j = 0; j < this.h; j++) {
      for (let i = 0; i < this.w; i++) {
        const [x, z] = this.cellCenter(i, j);
        let top = -Infinity;
        for (const b of boxes) {
          if (x >= b.min[0] && x < b.max[0] && z >= b.min[2] && z < b.max[2] && b.max[1] > top) top = b.max[1];
        }
        const k = j * this.w + i;
        this.floor[k] = top;
        if (top === -Infinity || top >= bounds.max[1]) continue;
        this.walkable[k] = collides([x, top + body.stepHeight + 0.01, z], boxes, probe) ? 0 : 1;
      }
    }
    this.#allocScratch();
  }

  // Scratch space for A*, reused between searches (a generation stamp avoids clearing it).
  #allocScratch() {
    const n = this.w * this.h;
    this.g = new Float32Array(n);
    this.came = new Int32Array(n);
    this.seen = new Uint32Array(n);
    this.done = new Uint32Array(n);
    this.gen = 0;
  }

  cellCenter(i, j) {
    return [this.minX + (i + 0.5) * this.cell, this.minZ + (j + 0.5) * this.cell];
  }

  cellOf(x, z) {
    return [Math.floor((x - this.minX) / this.cell), Math.floor((z - this.minZ) / this.cell)];
  }

  #open(i, j) {
    return i >= 0 && j >= 0 && i < this.w && j < this.h && this.walkable[j * this.w + i] === 1;
  }

  /**
   * A copy that shares the level data but treats `zones` (AABBs, x/z used) as blocked, e.g. so
   * one team's bots never path through the other team's spawn rooms.
   */
  withBlocked(zones) {
    const copy = new NavGrid(null, { from: this });
    for (const z of zones) {
      const [i0, j0] = this.cellOf(z.min[0], z.min[2]);
      const [i1, j1] = this.cellOf(z.max[0], z.max[2]);
      for (let j = Math.max(0, j0); j <= Math.min(this.h - 1, j1); j++) {
        for (let i = Math.max(0, i0); i <= Math.min(this.w - 1, i1); i++) copy.walkable[j * this.w + i] = 0;
      }
    }
    return copy;
  }

  /** Can a character walk from cell index a to neighbouring cell index b (climb/drop limits)? */
  #canStep(a, b) {
    const d = this.floor[b] - this.floor[a];
    return d <= this.step && -d <= this.maxDrop;
  }

  isWalkable(x, z) {
    const [i, j] = this.cellOf(x, z);
    return this.#open(i, j);
  }

  /** Floor height at (x, z), or -Infinity outside the level. */
  floorAt(x, z) {
    const [i, j] = this.cellOf(x, z);
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return -Infinity;
    return this.floor[j * this.w + i];
  }

  /** Closest walkable cell center to (x, z) within `maxRadius` world units, or null. */
  nearestWalkable(x, z, maxRadius = 8) {
    const [ci, cj] = this.cellOf(x, z);
    if (this.#open(ci, cj)) return [x, z];
    const rings = Math.ceil(maxRadius / this.cell);
    let best = null;
    let bestD = Infinity;
    for (let r = 1; r <= rings && !best; r++) {
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r || !this.#open(ci + di, cj + dj)) continue;
          const [cx, cz] = this.cellCenter(ci + di, cj + dj);
          const d = (cx - x) ** 2 + (cz - z) ** 2;
          if (d < bestD) { bestD = d; best = [cx, cz]; }
        }
      }
    }
    return best;
  }

  /** True if a straight walk from a to b ([x, z] or [x, y, z]) stays walkable and climbable. */
  clearLine(a, b) {
    const ax = a[0];
    const az = a.length === 3 ? a[2] : a[1];
    const bx = b[0];
    const bz = b.length === 3 ? b[2] : b[1];
    const dist = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.ceil(dist / (this.cell * 0.5)));
    let prev = -1;
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const [i, j] = this.cellOf(ax + (bx - ax) * t, az + (bz - az) * t);
      if (!this.#open(i, j)) return false;
      const cur = j * this.w + i;
      if (prev !== -1 && cur !== prev) {
        if (!this.#canStep(prev, cur)) return false;
        // Passing diagonally between cells: both corner cells must be passable too.
        const pi = prev % this.w;
        const pj = (prev - pi) / this.w;
        if (pi !== i && pj !== j) {
          const s1 = pj * this.w + i;
          const s2 = j * this.w + pi;
          if (!this.walkable[s1] || !this.walkable[s2] || !this.#canStep(prev, s1) || !this.#canStep(prev, s2)) return false;
        }
      }
      prev = cur;
    }
    return true;
  }

  /**
   * A* from `from` to `to` (each [x, y, z] or [x, z]). Returns smoothed waypoints [[x, z], ...]
   * ending at the goal (or the nearest walkable spot to it). Returns [] if there's no path.
   */
  findPath(from, to, { maxIterations = 60_000 } = {}) {
    const fx = from[0];
    const fz = from.length === 3 ? from[2] : from[1];
    const tx = to[0];
    const tz = to.length === 3 ? to[2] : to[1];
    const start = this.nearestWalkable(fx, fz);
    const goal = this.nearestWalkable(tx, tz);
    if (!start || !goal) return [];
    if (this.clearLine([fx, fz], goal)) return [goal];

    const w = this.w;
    const [si, sj] = this.cellOf(start[0], start[1]);
    const [gi, gj] = this.cellOf(goal[0], goal[1]);
    const startIdx = sj * w + si;
    const goalIdx = gj * w + gi;
    if (++this.gen >= 0xffffffff) {
      this.seen.fill(0);
      this.done.fill(0);
      this.gen = 1;
    }
    const gen = this.gen;
    const { g, came, seen, done } = this;
    const heap = new MinHeap();
    const hFn = (i, j) => {
      const dx = Math.abs(i - gi);
      const dz = Math.abs(j - gj);
      return Math.max(dx, dz) + (SQRT2 - 1) * Math.min(dx, dz); // octile distance
    };
    g[startIdx] = 0;
    came[startIdx] = -1;
    seen[startIdx] = gen;
    heap.push(startIdx, hFn(si, sj));

    let found = false;
    for (let iter = 0; heap.size && iter < maxIterations; iter++) {
      const cur = heap.pop();
      if (cur === goalIdx) { found = true; break; }
      if (done[cur] === gen) continue;
      done[cur] = gen;
      const ci = cur % w;
      const cj = (cur - ci) / w;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const ni = ci + di;
          const nj = cj + dj;
          if (!this.#open(ni, nj)) continue;
          const nk = nj * w + ni;
          if (done[nk] === gen || !this.#canStep(cur, nk)) continue;
          // No corner cutting: a diagonal step needs both side cells open and climbable.
          if (di && dj) {
            const s1 = cj * w + ni;
            const s2 = nj * w + ci;
            if (!this.walkable[s1] || !this.walkable[s2] || !this.#canStep(cur, s1) || !this.#canStep(cur, s2)) continue;
          }
          const cost = g[cur] + (di && dj ? SQRT2 : 1);
          if (seen[nk] !== gen || cost < g[nk]) {
            seen[nk] = gen;
            g[nk] = cost;
            came[nk] = cur;
            heap.push(nk, cost + hFn(ni, nj));
          }
        }
      }
    }
    if (!found) return [];

    const cells = [];
    for (let c = goalIdx; c !== -1 && c !== startIdx; c = came[c]) {
      const i = c % w;
      cells.push(this.cellCenter(i, (c - i) / w));
    }
    cells.reverse();
    if (!cells.length) return [goal];
    cells[cells.length - 1] = goal;
    return this.#smooth([fx, fz], cells);
  }

  // Greedy string-pulling: skip every waypoint that can be reached in a straight line.
  #smooth(start, points) {
    const out = [];
    let anchor = start;
    let i = 0;
    while (i < points.length) {
      let far = i;
      for (let k = points.length - 1; k > i; k--) {
        if (this.clearLine(anchor, points[k])) { far = k; break; }
      }
      out.push(points[far]);
      anchor = points[far];
      i = far + 1;
    }
    return out;
  }
}

class MinHeap {
  constructor() {
    this.items = [];
    this.prios = [];
  }

  get size() {
    return this.items.length;
  }

  push(item, prio) {
    const a = this.items;
    const p = this.prios;
    let n = a.length;
    a.push(item);
    p.push(prio);
    while (n > 0) {
      const parent = (n - 1) >> 1;
      if (p[parent] <= p[n]) break;
      [a[n], a[parent]] = [a[parent], a[n]];
      [p[n], p[parent]] = [p[parent], p[n]];
      n = parent;
    }
  }

  pop() {
    const a = this.items;
    const p = this.prios;
    const top = a[0];
    const lastItem = a.pop();
    const lastPrio = p.pop();
    if (a.length) {
      a[0] = lastItem;
      p[0] = lastPrio;
      let n = 0;
      for (;;) {
        const l = 2 * n + 1;
        const r = l + 1;
        let m = n;
        if (l < a.length && p[l] < p[m]) m = l;
        if (r < a.length && p[r] < p[m]) m = r;
        if (m === n) break;
        [a[n], a[m]] = [a[m], a[n]];
        [p[n], p[m]] = [p[m], p[n]];
        n = m;
      }
    }
    return top;
  }
}
