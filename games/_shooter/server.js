// Shared server core for first-person team shooter modes (CTF, Control Points, ...).
//
// Clients predict their own movement and send it ~30x/s; this core sanity-checks it (speed, walls,
// bounds) and is the authority on everything that matters for fairness: health, hits (with lag
// compensation), deaths, respawns, and the respawn wait. A mode supplies the map and plugs its
// objective in through hooks:
//
//   createShooter(ctx, {
//     map,                                     // { boxes, bounds, spawns: { red: [{pos, yaw}], ... } }
//     pickSpawn(st, defaultPick) -> {pos,yaw}  // optional: choose a spawn (e.g. forward spawns)
//     speedMul(st) -> number                   // optional: movement allowance multiplier
//     respawnTime(st) -> seconds               // optional: per-player respawn wait (default: the setting)
//     onKill(victim, killer, info)             // optional: e.g. drop a flag
//     onLeave(st)                              // optional: player left the match
//     tick(dt)                                 // the objective's per-tick logic
//     snapshotExtra() -> object                // merged into every 'snap' (objective state)
//   })
//
// Folders starting with "_" are not games themselves: the server never lists them.

import { History, v3, isVec, isNum, raycastBoxes, rayAABB, collides, clamp, lerpAngle } from '../../server/kit/index.js';
import { MOVE, BODY, HITBOX, WEAPON, PLAYER, NET } from './shared/constants.js';

export const TEAMS = ['red', 'blue'];
export const other = (team) => (team === 'red' ? 'blue' : 'red');
const round2 = (n) => Math.round(n * 100) / 100;
const lerpSample = (a, b, t) => ({ pos: v3.lerp(a.pos, b.pos, t), yaw: lerpAngle(a.yaw, b.yaw, t), alive: b.alive });

/** Hitboxes for a player standing at `pos` (feet). */
export function hitboxes(pos) {
  const b = HITBOX.body;
  const hd = HITBOX.head;
  return {
    body: { min: [pos[0] - b.radius, pos[1] + b.bottom, pos[2] - b.radius], max: [pos[0] + b.radius, pos[1] + b.top, pos[2] + b.radius] },
    head: { min: [pos[0] - hd.radius, pos[1] + hd.bottom, pos[2] - hd.radius], max: [pos[0] + hd.radius, pos[1] + hd.top, pos[2] + hd.radius] },
  };
}

/** The usual settings every shooter mode offers (spread into defineGame's `settings`). */
export const SHOOTER_SETTINGS = {
  respawnTime: { label: 'Respawn delay', default: 15, min: 0, max: 30, unit: 's' },
  friendlyFire: { label: 'Friendly fire', default: false },
};

export const SHOOTER_CONTROLS = [
  ['WASD', 'move'],
  ['Space', 'jump'],
  ['Mouse', 'aim / shoot'],
  ['R', 'reload'],
];

export function createShooter(ctx, mode) {
  const { settings } = ctx;
  const MAP = mode.map;
  const SOLIDS = MAP.boxes;
  // Lenient on purpose: the check exists to stop teleporting, not to police every jump.
  const MAX_SPEED = MOVE.runSpeed * 1.6;
  const states = new Map(); // playerId -> per-player state
  const pendingRespawn = new Map(); // playerId -> { at, life } for players who left the match while dead
  let lastSnapshot = 0;

  const eye = (st) => [st.pos[0], st.pos[1] + MOVE.eyeHeight, st.pos[2]];

  function defaultPick(team, points = MAP.spawns[team]) {
    const all = [...states.values()];
    const enemies = all.filter((s) => s.alive && s.team !== team);
    const free = points.filter((sp) => !all.some((s) => s.alive && v3.distXZ(s.pos, sp.pos) < 1));
    const list = free.length ? free : points;
    // Prefer the spawn farthest from the nearest enemy, with some randomness.
    let best = list[0];
    let bestScore = -Infinity;
    for (const sp of list) {
      let near = 50;
      for (const e of enemies) near = Math.min(near, v3.dist(e.pos, sp.pos));
      const score = near + Math.random() * 8;
      if (score > bestScore) { bestScore = score; best = sp; }
    }
    return best;
  }

  function spawn(st) {
    const sp = mode.pickSpawn?.(st, defaultPick) ?? defaultPick(st.team);
    st.life++;
    st.alive = true;
    st.hp = PLAYER.maxHealth;
    st.hpFloat = st.hp;
    st.pos = [...sp.pos];
    st.vel = [0, 0, 0];
    st.yaw = sp.yaw;
    st.pitch = 0;
    st.ammo = WEAPON.magSize;
    st.reloadUntil = 0;
    st.protectedUntil = ctx.time + PLAYER.spawnProtection;
    st.lastDamageAt = -Infinity;
    st.moveBudget = MAX_SPEED * 0.3;
    st.lastInputAt = ctx.time;
    st.history.clear();
    st.history.push(Date.now(), { pos: [...st.pos], yaw: st.yaw, alive: true });
    ctx.send(st.id, 'spawn', { life: st.life, pos: st.pos, yaw: st.yaw, hp: st.hp, ammo: st.ammo });
  }

  function kill(victim, killer, { headshot = false, cause = 'shot', respawnDelay = mode.respawnTime?.(victim) ?? settings.respawnTime } = {}) {
    if (!victim.alive) return;
    victim.alive = false;
    victim.hp = 0;
    victim.respawnAt = ctx.time + respawnDelay;
    victim.history.push(Date.now(), { pos: [...victim.pos], yaw: victim.yaw, alive: false });
    mode.onKill?.(victim, killer, { headshot, cause });
    if (cause !== 'switch') ctx.addStat(victim.id, 'deaths');
    if (killer && killer !== victim && killer.team !== victim.team) ctx.addStat(killer.id, 'kills');
    ctx.broadcast('kill', { victim: victim.id, killer: killer?.id ?? null, headshot, cause, pos: victim.pos, respawnIn: respawnDelay });
  }

  function damage(victim, attacker, amount, info) {
    if (!victim.alive || ctx.time < victim.protectedUntil) return;
    victim.hp = Math.max(0, victim.hp - amount);
    victim.lastDamageAt = ctx.time;
    ctx.send(victim.id, 'hurt', { from: attacker.id, amount, hp: victim.hp, dir: v3.round(v3.normalize(v3.sub(attacker.pos, victim.pos)), 2) });
    ctx.send(attacker.id, 'hitConfirm', { target: victim.id, headshot: info.headshot, kill: victim.hp <= 0 });
    if (victim.hp <= 0) kill(victim, attacker, info);
  }

  // ---------- input ----------

  function onMove(st, data) {
    if (!st.alive || data.life !== st.life) return; // stale input from a previous life
    const { p, v, y, x } = data;
    if (!isVec(p) || !isNum(y) || !isNum(x)) return;
    st.yaw = y;
    st.pitch = clamp(x, -1.55, 1.55);
    if (isVec(v)) st.vel = v.map((n) => clamp(n, -60, 60));

    // Movement budget: accrues with time, spent by distance travelled (falls are free).
    const elapsed = Math.max(0, ctx.time - st.lastInputAt);
    st.lastInputAt = ctx.time;
    const maxSpeed = MAX_SPEED * (mode.speedMul?.(st) ?? 1);
    st.moveBudget = Math.min(maxSpeed * 0.5, st.moveBudget + elapsed * maxSpeed);
    const d = [p[0] - st.pos[0], Math.max(0, p[1] - st.pos[1]), p[2] - st.pos[2]];
    const dist = v3.len(d);
    const b = MAP.bounds;
    const inBounds = p[0] > b.min[0] - 1 && p[0] < b.max[0] + 1 && p[2] > b.min[2] - 1 && p[2] < b.max[2] + 1 && p[1] < b.max[1];
    const tooFast = dist > st.moveBudget + 0.6;
    const inWall = collides(p, SOLIDS, BODY, 0.08);
    if (!inBounds || tooFast || inWall) {
      st.corrections++;
      ctx.send(st.id, 'correct', { life: st.life, pos: st.pos });
      return;
    }
    st.moveBudget = Math.max(0, st.moveBudget - dist);
    st.pos = [p[0], p[1], p[2]];
    st.history.push(Date.now(), { pos: [...st.pos], yaw: st.yaw, alive: true });
  }

  function onShoot(st, data) {
    if (!st.alive || data.life !== st.life) return;
    const { o, d, t } = data;
    if (!isVec(o) || !isVec(d) || !isNum(t)) return;

    // Fire-rate: a small bucket absorbs network jitter while still capping sustained rate.
    st.shotBucket = Math.min(3, st.shotBucket + (ctx.time - st.lastShotAt) / WEAPON.fireInterval);
    st.lastShotAt = ctx.time;
    if (st.shotBucket < 1 || ctx.time < st.reloadUntil - 0.15 || st.ammo <= 0) return;
    st.shotBucket -= 1;
    st.ammo--;
    st.protectedUntil = 0; // shooting ends spawn protection

    // The shot must come from roughly where we think the player's eye is.
    const serverEye = eye(st);
    const origin = v3.dist(o, serverEye) < 2 ? o : serverEye;
    const dir = v3.normalize(d);
    if (v3.len(dir) < 0.5) return;

    let best = raycastBoxes(origin, dir, SOLIDS, WEAPON.range).dist;
    let victim = null;
    let headshot = false;
    // Lag compensation: test targets where the shooter saw them, capped by maxRewindMs.
    const now = Date.now();
    const at = clamp(t, now - NET.maxRewindMs, now);
    for (const target of states.values()) {
      if (target === st || !target.alive) continue;
      if (target.team === st.team && !settings.friendlyFire) continue;
      const past = target.history.at(at) ?? { pos: target.pos, alive: true };
      if (!past.alive) continue;
      // Cheap reject before the box tests: is the target anywhere near the ray?
      const rel = v3.sub(past.pos, origin);
      const along = v3.dot(rel, dir);
      if (along < -1 || along > best + 1) continue;
      const boxes = hitboxes(past.pos);
      const tHead = rayAABB(origin, dir, boxes.head, best);
      const tBody = rayAABB(origin, dir, boxes.body, best);
      if (tHead < best && tHead <= tBody) {
        best = tHead;
        victim = target;
        headshot = true;
      } else if (tBody < best) {
        best = tBody;
        victim = target;
        headshot = false;
      }
    }

    const end = v3.add(origin, v3.scale(dir, Math.min(best, WEAPON.range)));
    ctx.broadcast('shot', { by: st.id, from: v3.round(origin, 2), to: v3.round(end, 2), hit: Boolean(victim) }, { except: st.id });
    if (victim) damage(victim, st, Math.round(WEAPON.damage * (headshot ? WEAPON.headshotMul : 1)), { headshot, cause: 'shot' });
  }

  function onReload(st) {
    if (!st.alive || st.ammo >= WEAPON.magSize || ctx.time < st.reloadUntil) return;
    st.reloadUntil = ctx.time + WEAPON.reloadTime;
    st.ammo = WEAPON.magSize; // refilled now; shooting is blocked until reloadUntil
  }

  // ---------- snapshots ----------

  function snapshot() {
    const players = [];
    for (const st of states.values()) {
      // `life` lets clients tell a respawn apart from movement, so they never blend across one.
      players.push([st.id, round2(st.pos[0]), round2(st.pos[1]), round2(st.pos[2]), round2(st.yaw), round2(st.pitch), st.hp, st.alive ? 1 : 0, st.team, st.life]);
    }
    return { t: Date.now(), players, ...(mode.snapshotExtra?.() ?? {}) };
  }

  function sendSelf(st) {
    ctx.send(st.id, 'self', { life: st.life, alive: st.alive, hp: st.hp, ammo: st.ammo, respawnIn: st.alive ? 0 : Math.max(0, st.respawnAt - ctx.time) });
  }

  // ---------- framework hooks (returned to defineGame's create) ----------

  const hooks = {
    onPlayerJoin(player) {
      const team = player.team ?? 'red';
      const st = {
        id: player.id,
        team,
        bot: player.bot,
        life: 0,
        alive: false,
        hp: 0,
        pos: [...MAP.spawns[team][0].pos],
        vel: [0, 0, 0],
        yaw: 0,
        pitch: 0,
        ammo: WEAPON.magSize,
        reloadUntil: 0,
        respawnAt: 0,
        protectedUntil: 0,
        lastDamageAt: -Infinity,
        moveBudget: 0,
        lastInputAt: ctx.time,
        lastShotAt: ctx.time,
        shotBucket: 3,
        corrections: 0,
        history: new History(1000, lerpSample),
      };
      states.set(player.id, st);
      // Send the full world so a late joiner sees everything immediately.
      ctx.send(player.id, 'init', { you: player.id, snapshot: snapshot() });
      // Leaving while dead (to spectate, or by refreshing) doesn't skip the respawn wait.
      const owed = pendingRespawn.get(player.id);
      pendingRespawn.delete(player.id);
      if (owed && owed.at > ctx.time) {
        st.respawnAt = owed.at;
        st.life = owed.life;
        sendSelf(st);
      } else {
        spawn(st);
      }
    },

    onPlayerLeave(player) {
      const st = states.get(player.id);
      if (!st) return;
      if (!st.alive && st.respawnAt > ctx.time) pendingRespawn.set(player.id, { at: st.respawnAt, life: st.life });
      // Choosing to spectate while alive costs a respawn wait too, so it can't be used to teleport home.
      else if (st.alive && player.spectating) pendingRespawn.set(player.id, { at: ctx.time + settings.respawnTime, life: st.life });
      mode.onLeave?.(st);
      states.delete(player.id);
      ctx.broadcast('gone', { id: player.id });
    },

    onSpectatorJoin(player) {
      ctx.send(player.id, 'init', { you: player.id, snapshot: snapshot(), spectating: true });
    },

    onTeamChange(player) {
      const st = states.get(player.id);
      if (!st) return;
      st.team = player.team;
      // Switching while alive counts as a respawn (full wait, no death stat). While dead, the timer just keeps running.
      if (st.alive) kill(st, null, { cause: 'switch' });
    },

    onMessage(player, type, data) {
      const st = states.get(player.id);
      if (!st) return;
      if (type === 'reload') return onReload(st);
      if (!data || typeof data !== 'object') return;
      if (type === 'move') onMove(st, data);
      else if (type === 'shoot') onShoot(st, data);
    },

    tick(dt) {
      for (const st of states.values()) {
        if (!st.alive) {
          if (ctx.time >= st.respawnAt) spawn(st);
          continue;
        }
        // Fell out of the world.
        if (st.pos[1] < MAP.bounds.min[1]) kill(st, null, { cause: 'fall' });
        // Regenerate after a while without taking damage.
        if (st.hp < PLAYER.maxHealth && ctx.time - st.lastDamageAt > PLAYER.regenDelay) {
          st.hpFloat = Math.min(PLAYER.maxHealth, (st.hpFloat ?? st.hp) + PLAYER.regenPerSecond * dt);
          st.hp = Math.floor(st.hpFloat);
        } else {
          st.hpFloat = st.hp;
        }
      }

      mode.tick?.(dt);

      const now = Date.now();
      if (now - lastSnapshot >= 1000 / NET.snapshotHz - 2) {
        lastSnapshot = now;
        ctx.broadcast('snap', snapshot());
        for (const st of states.values()) sendSelf(st);
      }
    },

    onEnd() {
      states.clear();
    },

    // Not a framework hook: lets tests and server-side debugging inspect a player's state.
    debugState: (id) => states.get(id),
  };

  return { hooks, states, kill, spawn, eye };
}

/**
 * Ends the match on time: the team with the higher `scoreOf` wins.
 * Returns true once it has ended the match.
 */
export function endOnTime(ctx, scoreOf, label = (n) => String(n)) {
  const r = scoreOf('red');
  const b = scoreOf('blue');
  if (r === b) {
    ctx.endMatch({ winner: null, text: `Time's up — draw, ${label(r)}–${label(b)}.` });
  } else {
    const w = r > b ? 'red' : 'blue';
    const name = ctx.teams.find((t) => t.id === w)?.name ?? w;
    ctx.endMatch({ winner: w, text: `Time's up — ${name} wins ${label(Math.max(r, b))}–${label(Math.min(r, b))}!` });
  }
  return true;
}
