// Shared bot brain for shooter modes. A bot is an ordinary client: it receives the same messages
// a browser gets ('snap', 'spawn', 'kill', ...) and sends the same ones ('move', 'shoot', 'reload').
// It moves with the same shared physics the browser uses, so the server validates it exactly like
// a human player. No outside services: every decision below is plain local code.
//
// This file does the soldiering (pathfinding, movement, spotting, aiming, shooting, getting
// unstuck). A mode supplies the objective:
//
//   createShooterBot({
//     map,                                   // { boxes, bounds }
//     goal(bot) -> [x,y,z] | null            // where to go now (called every tick)
//     arriveRadius(bot) -> number            // optional: how close counts as "there" (default 1)
//     wander(bot) -> number                  // optional: radius to mill around in once arrived
//     targetPriority(bot, enemy) -> number   // optional: lower = shoot first (e.g. flag carrier)
//     speedMul(bot) -> number                // optional (e.g. flag carriers are slower)
//     pushWhileFighting(bot) -> 0..1         // optional: keep advancing on the goal while shooting
//   })
//
// `bot` exposes: api, me, snap, players(), myTeam(), enemyTeam(), time, nav, role(), lane, seed, flatDist.

import { dirFromYawPitch, raycastBoxes, lerpAngle, clamp, v3 } from '../../shared/kit/math.js';
import { moveCharacter } from '../../shared/kit/physics.js';
import { NavGrid } from '../../shared/kit/navgrid.js';
import { MOVE, BODY, WEAPON, NET } from './shared/constants.js';

const TICK_MS = 1000 / 30;
const DIFFICULTY = {
  //        turn rad/s  aim error  reaction s  fire cone  extra spread  sight range
  easy: { turnRate: 2.5, aimError: 0.09, reaction: 0.75, fireCone: 0.14, spread: 0.03, sight: 45, strafe: 0 },
  normal: { turnRate: 5, aimError: 0.045, reaction: 0.4, fireCone: 0.08, spread: 0.012, sight: 65, strafe: 0.5 },
  hard: { turnRate: 9, aimError: 0.018, reaction: 0.2, fireCone: 0.045, spread: 0.004, sight: 85, strafe: 1 },
};

// Nav grids are built once per map (and per team, when the map has spawn zones to avoid) and
// shared by every bot in the process.
const navCache = new WeakMap();
export function navFor(map, team = null) {
  if (!navCache.has(map)) {
    const base = new NavGrid(map.boxes, { bounds: map.bounds, cell: map.navCell ?? 0.5, body: BODY });
    const perTeam = {};
    if (map.zones) for (const t of Object.keys(map.zones)) perTeam[t] = base.withBlocked(map.zones[t === 'red' ? 'blue' : 'red']);
    navCache.set(map, { base, perTeam });
  }
  const entry = navCache.get(map);
  return (team && entry.perTeam[team]) || entry.base;
}

export const other = (team) => (team === 'red' ? 'blue' : 'red');
export const flatDist = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const yawTo = (from, to) => Math.atan2(-(to[0] - from[0]), -(to[2] - from[2]));
const angleDiff = (a, b) => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};

export function createShooterBot(mode) {
  const MAP = mode.map;
  return {
    mount(api) {
      // The bot's team can change mid-match, so look the grid up each time it's needed.
      const navNow = () => navFor(MAP, api.player()?.team);
      navFor(MAP); // build it now, not on the first tick
      const skill = DIFFICULTY[api.options.difficulty] ?? DIFFICULTY.normal;
      // Stable per-bot numbers so a team spreads out (routes, roles, wandering).
      const seed = [...api.me].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
      const me = { life: 0, alive: false, pos: [0, 0, 0], vel: [0, 0, 0], onGround: false, yaw: 0, pitch: 0, ammo: WEAPON.magSize, reloadUntil: 0, nextShotAt: 0, lastShotAt: 0 };
      let snap = null; // latest world snapshot
      let playersCache = null;
      let time = 0;
      let lastTick = performance.now();
      let path = [];
      let pathGoal = null;
      let repathAt = 0;
      let target = null; // { id, seenAt }
      let attackerHint = null; // { id, until }
      let aimOffset = [0, 0];
      let aimOffsetAt = 0;
      let stuck = { pos: [0, 0, 0], at: 0, strikes: 0 };
      let detour = null; // temporary waypoint used to get unstuck
      let strafeDir = 1;
      let strafeAt = 0;
      let wanderSpot = null;
      let wanderAt = 0;
      let sightCheckAt = 0;
      let visible = new Set();

      const myTeam = () => api.player()?.team ?? 'red';
      const eye = (pos) => [pos[0], pos[1] + MOVE.eyeHeight, pos[2]];

      const bot = {
        api,
        me,
        seed,
        get nav() { return navNow(); },
        flatDist,
        get snap() { return snap; },
        get time() { return time; },
        myTeam,
        enemyTeam: () => other(myTeam()),
        players() {
          playersCache ??= (snap?.players ?? []).map(([id, x, y, z, yaw, pitch, hp, alive, team]) => ({ id, pos: [x, y, z], yaw, pitch, hp, alive: alive === 1, team }));
          return playersCache;
        },
        /**
         * Stable index of this bot among its team's bots (0..n-1) and the count, for splitting roles.
         * Humans count toward the team size but never get a role.
         */
        teamSlot() {
          const team = myTeam();
          const mates = api.players().filter((p) => p.team === team && p.connected && !p.spectating);
          const bots = mates.filter((p) => p.bot).sort((a, b) => a.id.localeCompare(b.id));
          return { index: bots.findIndex((p) => p.id === api.me), bots: bots.length, team: mates.length };
        },
      };

      function canSee(from, to, range = skill.sight) {
        const o = eye(from);
        const t = [to[0], to[1] + 1.2, to[2]];
        const d = v3.sub(t, o);
        const dist = v3.len(d);
        if (dist > range) return false;
        return raycastBoxes(o, v3.scale(d, 1 / dist), MAP.boxes, dist).dist >= dist - 0.3;
      }

      // ---------- network ----------
      api.on('init', ({ snapshot }) => { snap = snapshot; playersCache = null; });
      api.on('snap', (s) => {
        if (!snap || s.t >= snap.t) {
          snap = s;
          playersCache = null;
        }
      });
      api.on('spawn', (s) => {
        Object.assign(me, { life: s.life, alive: true, pos: [...s.pos], vel: [0, 0, 0], onGround: false, yaw: s.yaw, pitch: 0, ammo: s.ammo, reloadUntil: 0 });
        path = [];
        pathGoal = null;
        target = null;
        detour = null;
        wanderSpot = null;
        stuck = { pos: [...me.pos], at: time, strikes: 0 };
      });
      api.on('correct', ({ life, pos }) => {
        if (life !== me.life) return;
        me.pos = [...pos];
        me.vel = [0, 0, 0];
        repathAt = 0;
      });
      api.on('kill', ({ victim }) => {
        if (victim === api.me) me.alive = false;
        if (target?.id === victim) target = null;
      });
      api.on('hurt', ({ from }) => { attackerHint = { id: from, until: time + 2.5 }; });
      api.on('self', (s) => {
        if (s.life !== me.life) return;
        if (!s.alive) me.alive = false;
        if (time - me.lastShotAt > 0.5 && time > me.reloadUntil) me.ammo = s.ammo;
      });

      // ---------- movement planning ----------
      function updatePath(goal) {
        const moved = !pathGoal || flatDist(goal, pathGoal) > 2;
        if (!moved && time < repathAt && path.length) return;
        pathGoal = [...goal];
        repathAt = time + 1.5 + Math.random() * 1;
        path = navNow().findPath(me.pos, goal);
        if (!path.length) path = [[goal[0], goal[2]]];
      }

      /** Once at the goal, drift between nearby spots so a group doesn't stand in one pile. */
      function wanderGoal(goal, radius) {
        if (!wanderSpot || time > wanderAt || flatDist(wanderSpot, goal) > radius + 2) {
          const nav = navNow();
          wanderSpot = [...goal];
          // Only pick spots you can walk to in a straight line from the goal: a random spot can
          // land on top of a wall or crate, and trying to reach it gets a bot stuck.
          for (let attempt = 0; attempt < 6; attempt++) {
            const a = Math.random() * Math.PI * 2;
            const r = Math.sqrt(Math.random()) * radius;
            const spot = nav.nearestWalkable(goal[0] + Math.cos(a) * r, goal[2] + Math.sin(a) * r, 2);
            if (spot && nav.clearLine([goal[0], goal[2]], spot)) {
              wanderSpot = [spot[0], nav.floorAt(spot[0], spot[1]), spot[1]];
              break;
            }
          }
          wanderAt = time + 2.5 + Math.random() * 3;
        }
        return wanderSpot;
      }

      // ---------- combat ----------
      function pickTarget(everyone) {
        const enemyTeam = other(myTeam());
        // Line-of-sight raycasts are the expensive part; refresh them a few times a second.
        if (time >= sightCheckAt) {
          sightCheckAt = time + 0.12 + Math.random() * 0.06;
          visible = new Set();
          for (const p of everyone) {
            if (!p.alive || p.team !== enemyTeam) continue;
            if (v3.dist(me.pos, p.pos) > skill.sight) continue;
            const facing = Math.abs(angleDiff(me.yaw, yawTo(me.pos, p.pos)));
            const d = v3.dist(me.pos, p.pos);
            const noticed = facing < 1.2 || d < 8 || (attackerHint?.id === p.id && time < attackerHint.until);
            if (noticed && canSee(me.pos, p.pos)) visible.add(p.id);
          }
        }
        let best = null;
        let bestScore = Infinity;
        for (const p of everyone) {
          if (!visible.has(p.id) || !p.alive) continue;
          const score = v3.dist(me.pos, p.pos) + (mode.targetPriority?.(bot, p) ?? 0) + (target?.id === p.id ? -5 : 0);
          if (score < bestScore) {
            bestScore = score;
            best = p;
          }
        }
        if (!best) {
          target = null;
          return null;
        }
        if (target?.id !== best.id) target = { id: best.id, seenAt: time };
        return best;
      }

      // ---------- per-tick update ----------
      function tick() {
        const now = performance.now();
        const dt = Math.min(0.1, (now - lastTick) / 1000);
        lastTick = now;
        time += dt;
        if (!me.alive || !snap) return;

        const everyone = bot.players();
        let goal = mode.goal(bot);
        const arrive = mode.arriveRadius?.(bot) ?? 1;
        if (goal && flatDist(me.pos, goal) < arrive) {
          const r = mode.wander?.(bot) ?? 0;
          if (r > 0) goal = wanderGoal(goal, r);
        }
        if (detour) goal = detour;
        if (goal) updatePath(goal);

        // Walk along the path.
        while (path.length && Math.hypot(path[0][0] - me.pos[0], path[0][1] - me.pos[2]) < 0.6) path.shift();
        if (detour && !path.length) detour = null;
        let wish = [0, 0];
        const atGoal = !path.length || (goal && flatDist(me.pos, goal) < 0.7);
        if (!atGoal) {
          const wp = path[0];
          const dx = wp[0] - me.pos[0];
          const dz = wp[1] - me.pos[2];
          const l = Math.hypot(dx, dz) || 1;
          wish = [dx / l, dz / l];
        }

        // Combat: aim at a visible enemy, strafe a little, shoot when on target.
        const foe = pickTarget(everyone);
        let wantYaw = wish[0] || wish[1] ? Math.atan2(-wish[0], -wish[1]) : me.yaw;
        let wantPitch = 0;
        let turnRate = 8;
        if (foe) {
          if (time > aimOffsetAt) {
            aimOffset = [(Math.random() - 0.5) * 2 * skill.aimError, (Math.random() - 0.5) * 2 * skill.aimError];
            aimOffsetAt = time + 0.4 + Math.random() * 0.4;
          }
          const aimPoint = [foe.pos[0], foe.pos[1] + 1.1, foe.pos[2]];
          const o = eye(me.pos);
          wantYaw = yawTo(o, aimPoint) + aimOffset[0];
          wantPitch = Math.atan2(aimPoint[1] - o[1], Math.hypot(aimPoint[0] - o[0], aimPoint[2] - o[2])) + aimOffset[1];
          turnRate = skill.turnRate;
          if (skill.strafe && time > strafeAt) {
            strafeDir = Math.random() < 0.5 ? -1 : 1;
            strafeAt = time + 0.5 + Math.random() * 0.8;
          }
          // A mode can tell bots to keep pushing toward the objective while fighting (e.g. onto a
          // capture point), instead of slowing to duel.
          const push = mode.pushWhileFighting?.(bot) ?? 0;
          if (skill.strafe) {
            // Sidestep perpendicular to the enemy while still drifting toward the goal, but only
            // where the floor allows it, so bots don't strafe off ledges or into walls.
            const side = [Math.cos(wantYaw) * strafeDir, -Math.sin(wantYaw) * strafeDir];
            const probe = [me.pos[0] + side[0] * 1.2, me.pos[2] + side[1] * 1.2];
            const ok = navNow().isWalkable(probe[0], probe[1]) && Math.abs(navNow().floorAt(probe[0], probe[1]) - me.pos[1]) < 0.6;
            if (!ok) strafeDir = -strafeDir;
            else {
              const fwd = 0.6 + 0.4 * push;
              const sideways = skill.strafe * 0.7 * (1 - 0.6 * push);
              wish = [wish[0] * fwd + side[0] * sideways, wish[1] * fwd + side[1] * sideways];
              const l = Math.hypot(wish[0], wish[1]);
              if (l > 1) wish = [wish[0] / l, wish[1] / l];
            }
          }
        }
        const yawStep = clamp(angleDiff(me.yaw, wantYaw), -turnRate * dt, turnRate * dt);
        me.yaw += yawStep;
        me.pitch = clamp(lerpAngle(me.pitch, wantPitch, Math.min(1, turnRate * dt)), -1.5, 1.5);

        // Movement: same acceleration model as the browser client.
        const speed = MOVE.runSpeed * (mode.speedMul?.(bot) ?? 1);
        const k = 1 - Math.exp(-(me.onGround ? MOVE.groundAccel : MOVE.airAccel) * dt);
        me.vel[0] += (wish[0] * speed - me.vel[0]) * k;
        me.vel[2] += (wish[1] * speed - me.vel[2]) * k;
        me.vel[1] -= MOVE.gravity * dt;

        // Unstick: barely moved while trying to? Jump and re-plan; if that keeps failing, take a
        // short detour to a random nearby walkable spot (another bot is probably in the way).
        if (time - stuck.at > 1.2) {
          const tryingToMove = !atGoal && !foe;
          if (tryingToMove && flatDist(me.pos, stuck.pos) < 0.5) {
            stuck.strikes++;
            if (me.onGround) me.vel[1] = MOVE.jumpVelocity;
            repathAt = 0;
            if (stuck.strikes >= 2) {
              // Detour to a nearby spot we can actually walk to (not on top of a wall or crate).
              const nav = navNow();
              for (let attempt = 0; attempt < 8; attempt++) {
                const a = Math.random() * Math.PI * 2;
                const spot = nav.nearestWalkable(me.pos[0] + Math.cos(a) * 4, me.pos[2] + Math.sin(a) * 4, 2);
                if (spot && nav.findPath(me.pos, [spot[0], 0, spot[1]]).length) {
                  detour = [spot[0], nav.floorAt(spot[0], spot[1]), spot[1]];
                  break;
                }
              }
              stuck.strikes = 0;
            }
          } else {
            stuck.strikes = 0;
          }
          stuck.pos = [...me.pos];
          stuck.at = time;
        }
        moveCharacter(me, dt, MAP.boxes, BODY);
        if (me.onGround && me.vel[1] < 0) me.vel[1] = 0;

        api.send('move', {
          life: me.life,
          p: me.pos.map((n) => Math.round(n * 1000) / 1000),
          v: me.vel.map((n) => Math.round(n * 100) / 100),
          y: Math.round(me.yaw * 1000) / 1000,
          x: Math.round(me.pitch * 1000) / 1000,
        });

        // Shooting.
        const reloading = time < me.reloadUntil;
        if (!reloading && me.ammo <= 0) reload();
        else if (!foe && !reloading && me.ammo < WEAPON.magSize / 3) reload();
        if (foe && !reloading && me.ammo > 0 && time >= me.nextShotAt && time - target.seenAt >= skill.reaction) {
          const aimErr = Math.abs(angleDiff(me.yaw, wantYaw - aimOffset[0])) + Math.abs(me.pitch - (wantPitch - aimOffset[1]));
          if (aimErr < skill.fireCone + skill.aimError) shoot();
        }
      }

      function shoot() {
        const s = WEAPON.spread + skill.spread;
        const dir = dirFromYawPitch(me.yaw + (Math.random() - 0.5) * 2 * s, me.pitch + (Math.random() - 0.5) * 2 * s);
        // We aimed at the newest snapshot, so ask the server to judge the shot at that moment.
        api.send('shoot', { life: me.life, o: eye(me.pos), d: dir, t: snap.t ?? Math.round(api.serverNow() - NET.interpDelayMs) });
        me.ammo--;
        me.lastShotAt = time;
        me.nextShotAt = time + WEAPON.fireInterval * (1 + Math.random() * 0.4);
      }

      function reload() {
        if (me.ammo >= WEAPON.magSize) return;
        me.reloadUntil = time + WEAPON.reloadTime + 0.05;
        me.ammo = WEAPON.magSize;
        api.send('reload');
      }

      // Spread bots' ticks out so 20 of them don't all fire on the same millisecond.
      let timer = null;
      const startDelay = setTimeout(() => {
        lastTick = performance.now();
        timer = setInterval(tick, TICK_MS);
        timer.unref?.();
      }, seed % TICK_MS);
      startDelay.unref?.();

      return {
        // For tests and debugging: what the bot is doing right now.
        debug: () => ({ goal: pathGoal?.map((n) => Math.round(n)), objective: bot.objective ? `${bot.objective.kind} ${bot.objective.idx}` : null, staging: bot.staging ?? null, target: target?.id ?? null }),
        destroy() {
          clearTimeout(startDelay);
          clearInterval(timer);
        },
      };
    },
  };
}
