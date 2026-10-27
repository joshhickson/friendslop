// Box-world character controller shared by client (prediction) and server (validation).
// The world is a list of solid AABBs: { min: [x,y,z], max: [x,y,z] }.
// A character is an upright box: feet at `pos`, half-width `radius`, height `height`.

export const DEFAULT_BODY = Object.freeze({ radius: 0.4, height: 1.8, stepHeight: 0.55 });

function overlaps(px, py, pz, r, hgt, b) {
  return px + r > b.min[0] && px - r < b.max[0] &&
    py + hgt > b.min[1] && py < b.max[1] &&
    pz + r > b.min[2] && pz - r < b.max[2];
}

/** True if a character standing at `pos` would intersect any solid box. */
export function collides(pos, boxes, body = DEFAULT_BODY, shrink = 0) {
  const r = body.radius - shrink;
  const hgt = body.height - shrink * 2;
  for (const b of boxes) if (overlaps(pos[0], pos[1] + shrink, pos[2], r, hgt, b)) return true;
  return false;
}

function moveAxis(state, axis, delta, boxes, body, allowStep) {
  if (delta === 0) return;
  const p = state.pos;
  const r = body.radius;
  const hgt = body.height;
  p[axis] += delta;
  for (const b of boxes) {
    if (!overlaps(p[0], p[1], p[2], r, hgt, b)) continue;
    // Step up onto low ledges (stairs, curbs) instead of stopping.
    const rise = b.max[1] - p[1];
    if (allowStep && rise > 0 && rise <= body.stepHeight) {
      const oldY = p[1];
      p[1] = b.max[1] + 1e-4;
      if (!collides(p, boxes, body)) {
        state.stepped = true;
        continue;
      }
      p[1] = oldY;
    }
    if (axis === 1) {
      if (delta > 0) p[1] = b.min[1] - hgt - 1e-4;
      else {
        p[1] = b.max[1] + 1e-4;
        state.onGround = true;
      }
    } else if (delta > 0) {
      p[axis] = b.min[axis] - r - 1e-4;
    } else {
      p[axis] = b.max[axis] + r + 1e-4;
    }
    state.vel[axis] = 0;
  }
}

/**
 * Integrate one step of movement with collision. Mutates and returns `state`:
 *   state = { pos: [x,y,z], vel: [x,y,z], onGround: bool }
 * `vel` is in units/second; gravity is applied by the caller.
 */
export function moveCharacter(state, dt, boxes, body = DEFAULT_BODY) {
  const dx = state.vel[0] * dt;
  const dy = state.vel[1] * dt;
  const dz = state.vel[2] * dt;
  // Sub-step fast moves so thin walls can't be skipped.
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) / (body.radius * 0.8)));
  const wasGrounded = state.onGround;
  state.onGround = false;
  state.stepped = false;
  for (let i = 0; i < steps; i++) {
    moveAxis(state, 0, dx / steps, boxes, body, wasGrounded);
    moveAxis(state, 2, dz / steps, boxes, body, wasGrounded);
    moveAxis(state, 1, dy / steps, boxes, body, false);
  }
  // Stick to the ground when walking down small steps.
  if (wasGrounded && !state.onGround && state.vel[1] <= 0) {
    const probe = { pos: [...state.pos], vel: [0, -1, 0], onGround: false };
    moveAxis(probe, 1, -body.stepHeight, boxes, body, false);
    if (probe.onGround) {
      state.pos[1] = probe.pos[1];
      state.onGround = true;
      state.vel[1] = 0;
    }
  }
  return state;
}
