// Small, dependency-free math helpers usable on both server and client.
// Vectors are plain [x, y, z] arrays so they serialize to JSON as-is.

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;

/** Interpolate angles in radians along the shortest arc. */
export function lerpAngle(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export const v3 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  dist: (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]),
  distXZ: (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]),
  lerp: (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)],
  normalize(a) {
    const l = Math.hypot(a[0], a[1], a[2]);
    return l > 1e-9 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
  },
  round: (a, places = 2) => {
    const m = 10 ** places;
    return [Math.round(a[0] * m) / m, Math.round(a[1] * m) / m, Math.round(a[2] * m) / m];
  },
};

/** True if `v` is an array of `n` finite numbers. Use this on every vector a client sends you. */
export function isVec(v, n = 3) {
  if (!Array.isArray(v) || v.length !== n) return false;
  for (let i = 0; i < n; i++) if (typeof v[i] !== 'number' || !Number.isFinite(v[i])) return false;
  return true;
}

export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Forward direction for a yaw/pitch pair, using the three.js convention
 * (camera looks down -Z when yaw = pitch = 0, rotation order 'YXZ').
 */
export function dirFromYawPitch(yaw, pitch) {
  const cp = Math.cos(pitch);
  return [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
}

/**
 * Ray vs axis-aligned box (slab method).
 * box = { min: [x,y,z], max: [x,y,z] }. `dir` should be normalized.
 * Returns the hit distance along the ray, or Infinity if missed / beyond maxDist.
 */
export function rayAABB(origin, dir, box, maxDist = Infinity) {
  let tmin = 0;
  let tmax = maxDist;
  for (let i = 0; i < 3; i++) {
    const o = origin[i];
    const d = dir[i];
    const lo = box.min[i];
    const hi = box.max[i];
    if (Math.abs(d) < 1e-12) {
      if (o < lo || o > hi) return Infinity;
      continue;
    }
    let t1 = (lo - o) / d;
    let t2 = (hi - o) / d;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return Infinity;
  }
  return tmin;
}

/** Ray vs sphere. Returns hit distance or Infinity. */
export function raySphere(origin, dir, center, radius, maxDist = Infinity) {
  const oc = [origin[0] - center[0], origin[1] - center[1], origin[2] - center[2]];
  const b = oc[0] * dir[0] + oc[1] * dir[1] + oc[2] * dir[2];
  const c = oc[0] * oc[0] + oc[1] * oc[1] + oc[2] * oc[2] - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return Infinity;
  const s = Math.sqrt(disc);
  let t = -b - s;
  if (t < 0) t = -b + s;
  if (t < 0 || t > maxDist) return Infinity;
  return t;
}

/** Nearest hit of a ray against a list of boxes. Returns { dist, box } (dist = Infinity if none). */
export function raycastBoxes(origin, dir, boxes, maxDist = Infinity) {
  let best = maxDist;
  let hit = null;
  for (const b of boxes) {
    const t = rayAABB(origin, dir, b, best);
    if (t < best) { best = t; hit = b; }
  }
  return { dist: hit ? best : Infinity, box: hit };
}

export function pointInAABB(p, box, pad = 0) {
  return p[0] > box.min[0] - pad && p[0] < box.max[0] + pad &&
    p[1] > box.min[1] - pad && p[1] < box.max[1] + pad &&
    p[2] > box.min[2] - pad && p[2] < box.max[2] + pad;
}
