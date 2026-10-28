// Control Points — bot player. The soldiering (pathing, aiming, shooting, unsticking) is shared
// with every shooter mode (games/_shooter/bot.js); this file decides where a CP bot should be.
//
// Strategy, per team:
// - The front line is the pair of points where the teams meet. Bots split between attacking the
//   next point they can capture and defending the point the enemy can capture from them.
// - On the way to a point that lies past a wall, each bot heads for "its" gap in that wall first
//   (main gate, flank alley or high walkway), so a team spreads across the routes instead of
//   funnelling through one door.
// - Once on a point they mill around inside the capture circle rather than stacking in the middle.
// - They never path into the enemy's spawn rooms (those hurt), and target enemies on contested
//   points first.

import { createShooterBot, flatDist } from '../_shooter/bot.js';
import { pointInAABB } from '../../shared/kit/math.js';
import { CP_MAP as MAP } from './shared/map.js';
import { CAPTURE } from './shared/constants.js';

const POINTS = MAP.points;

/** Points `team` can capture right now, and points the enemy can take from `team`. */
function frontLine(bot) {
  const pts = bot.snap?.points;
  if (!pts) return null;
  const team = bot.myTeam();
  const t = team === 'red' ? 0 : 1;
  const e = 1 - t;
  return {
    attack: pts.map((p, i) => (p.ok[t] ? i : -1)).filter((i) => i >= 0),
    defend: pts.map((p, i) => (p.ok[e] && p.o === team ? i : -1)).filter((i) => i >= 0),
    pts,
  };
}

/** Choose the point this bot works on. Stable per bot so the team doesn't flicker between tasks. */
function chooseObjective(bot) {
  const fl = frontLine(bot);
  if (!fl) return null;
  const { attack, defend, pts } = fl;
  const slot = bot.teamSlot();
  const team = bot.myTeam();
  // Anything actively being captured from us gets extra hands.
  const threatened = defend.filter((i) => pts[i].c && pts[i].c !== team && pts[i].p > 0);
  // Share of the team that defends: more when a point is being taken, fewer when nothing threatens.
  const defendShare = !defend.length ? 0 : threatened.length ? 0.6 : attack.length ? 0.35 : 1;
  const defenders = Math.round(slot.bots * defendShare);
  const pick = (list, k) => list[k % list.length];
  // Interleave by slot index so attackers and defenders are spread across the roster.
  const order = (slot.index * 7) % Math.max(1, slot.bots);
  if (order < defenders && defend.length) return { idx: pick(threatened.length ? threatened : defend, order), kind: 'defend' };
  if (attack.length) {
    // Usually every attacker hits the same point (focus beats splitting); C first if it's neutral.
    const neutral = attack.filter((i) => !pts[i].o);
    return { idx: neutral.length ? neutral[0] : pick(attack, 0), kind: 'attack' };
  }
  if (defend.length) return { idx: pick(defend, order), kind: 'defend' };
  return null;
}

/** If a wall lies between the bot and the target, the door in it this bot should use. */
function routeVia(bot, target) {
  const z0 = bot.me.pos[2];
  const z1 = target[2];
  const lo = Math.min(z0, z1);
  const hi = Math.max(z0, z1);
  // Nearest wall between us and the target (in walking order).
  const between = MAP.gates.filter((g) => g.z > lo + 1 && g.z < hi - 1);
  if (!between.length) return null;
  const gate = z1 > z0 ? between[0] : between[between.length - 1];
  // Each bot has a favourite door per wall (from its seed), spreading the team over all routes.
  // (>>> keeps it unsigned: seeds are 32-bit, and >> could make the index negative.)
  const door = gate.doors[(bot.seed >>> 2) % gate.doors.length];
  // Close enough to the door already? Then head straight on.
  if (Math.abs(bot.me.pos[2] - gate.z) < 3) return null;
  return [door[0], bot.nav.floorAt(door[0], door[1]), door[1]];
}

const inEnemySpawn = (team, pos) => MAP.zones[team === 'red' ? 'blue' : 'red'].some((z) => pointInAABB(pos, z));

// ---- coordinated pushes ------------------------------------------------------------
// Attackers who trickle onto a point one at a time just die. Instead, a team gathers at a
// staging spot short of the point (on its own side) and pushes in together once enough of
// its attackers have arrived, or after a timeout so it never waits forever. State is shared
// per team by every bot in this process (each bot still only acts on what it can see).
const STAGE_BACK = 8; // staging distance back from the last wall before the point (your side)
const PUSH_RATIO = 0.6; // fraction of the living attackers that must be staged
const STAGE_TIMEOUT = 12; // seconds before pushing anyway
const PUSH_SECONDS = 20; // how long a push lasts before regrouping
const pushes = new Map(); // `${roomKey}:${team}:${pointIdx}` -> { stagedAt, pushingUntil }

function stagingSpot(bot, idx) {
  const p = POINTS[idx].pos;
  const back = bot.myTeam() === 'red' ? -1 : 1;
  // Gather behind the last wall on the way to the point, so the group waits in cover on its own
  // side instead of in the defenders' line of fire. (No wall in between: just stand off a bit.)
  const prev = POINTS[idx + back].pos;
  const walls = MAP.gates.filter((g) => g.z > Math.min(prev[2], p[2]) && g.z < Math.max(prev[2], p[2]));
  const wall = walls.sort((a, b) => Math.abs(a.z - p[2]) - Math.abs(b.z - p[2]))[0];
  const z = wall ? wall.z + back * STAGE_BACK : p[2] + back * 16;
  // Spread the group sideways a little so it doesn't stand in one pile.
  const x = p[0] + (((bot.seed >>> 4) % 5) - 2) * 3;
  const spot = bot.nav.nearestWalkable(x, z, 6) ?? [p[0], z];
  return [spot[0], bot.nav.floorAt(spot[0], spot[1]), spot[1]];
}

/** Attack goal for the bot: the staging spot while the team gathers, the point once it pushes. */
function attackGoal(bot, idx) {
  const team = bot.myTeam();
  const pts = bot.snap.points;
  const target = POINTS[idx].pos;
  // Already being captured by us, or nobody of theirs around: no need to wait, go.
  if ((pts[idx].c === team && pts[idx].p > 0) || pts[idx].n[team === 'red' ? 0 : 1] > 0) return target;
  const key = `${bot.api.room?.id}:${team}:${idx}`;
  let push = pushes.get(key);
  if (!push) {
    push = { stagedAt: bot.time, pushingUntil: 0 };
    pushes.set(key, push);
  }
  if (bot.time < push.pushingUntil) return target;
  // Count living teammates near the staging area vs. living teammates in total.
  const stage = stagingSpot(bot, idx);
  const mates = bot.players().filter((p) => p.alive && p.team === team);
  const staged = mates.filter((p) => Math.hypot(p.pos[0] - stage[0], p.pos[2] - stage[2]) < 12).length;
  if (staged >= Math.max(2, Math.ceil(mates.length * PUSH_RATIO)) || bot.time - push.stagedAt > STAGE_TIMEOUT) {
    push.pushingUntil = bot.time + PUSH_SECONDS;
    push.stagedAt = bot.time + PUSH_SECONDS; // the next gathering starts after this push
    return target;
  }
  return stage;
}

export default createShooterBot({
  map: MAP,

  goal(bot) {
    const obj = chooseObjective(bot);
    if (!obj) return null;
    bot.objective = obj;
    const target = obj.kind === 'attack' ? attackGoal(bot, obj.idx) : POINTS[obj.idx].pos;
    bot.staging = target !== POINTS[obj.idx].pos;
    const via = routeVia(bot, target);
    if (via && !inEnemySpawn(bot.myTeam(), via)) return via;
    return target;
  },

  // Once a push is on, keep moving onto the point while shooting: standing in the doorway trading
  // shots with the defenders never takes a point.
  pushWhileFighting: (bot) => (bot.objective?.kind === 'attack' && !bot.staging ? 1 : 0),

  // Mill around inside the capture circle (and a bit around it when defending or staging).
  arriveRadius: (bot) => (bot.staging ? 3 : bot.objective ? CAPTURE.radius - 1 : 1),
  wander: (bot) => (bot.staging ? 4 : bot.objective?.kind === 'defend' ? CAPTURE.radius + 2 : CAPTURE.radius - 1.5),

  // Shoot enemies standing on contested points first.
  targetPriority(bot, enemy) {
    const pts = bot.snap?.points;
    if (!pts) return 0;
    for (let i = 0; i < pts.length; i++) {
      if (!pts[i].x) continue;
      if (flatDist(enemy.pos, POINTS[i].pos) < CAPTURE.radius + 1) return -20;
    }
    return 0;
  },
});
