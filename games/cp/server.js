// Control Points — server side. Movement, shooting, health and respawns come from the shared
// shooter core (games/_shooter/server.js); this file adds the capture points.
//
// Rules (classic 5-point control):
// - Seven points in a line: each team's base (never capturable) and five capture points A..E.
//   Each team starts owning the two points nearest its base; the middle one (C) starts neutral.
// - You can only capture a point next to one your team already owns, so the front line moves
//   point by point. A point can be retaken the same way.
// - Standing on a point captures it; more teammates capture faster (diminishing returns).
//   Enemies on the point contest it and freeze progress. Empty points slowly lose progress.
//   An enemy-owned point must first be brought down to neutral, then captured.
// - A team holding its second point (B for red, D for blue) spawns at its forward spawn room.
// - Enemies standing in your spawn areas take damage over time (stops spawn camping).
// - A team that just lost a point respawns faster for a while (helps the defence regroup), and the
//   team that owns more points respawns slower, so the side that is behind gets windows to push.
// - Every capture adds time to the clock, and the match can't end on time while a point is being
//   captured (overtime: it ends when that capture completes or fails).
// - Win: own all five capture points. Time limit: the team holding more points wins.

import { defineGame, pointInAABB } from '../../server/kit/index.js';
import { createShooter, endOnTime, other, SHOOTER_SETTINGS, SHOOTER_CONTROLS } from '../_shooter/server.js';
import { CP_MAP as MAP } from './shared/map.js';
import { CAPTURE } from './shared/constants.js';

const SPAWN_ZONE_DPS = 40;

export default defineGame({
  id: 'cp',
  name: 'Control Points',
  description: '10 v 10 on a long map with five capture points. Push the front line point by point: own all five to win. Bots fill empty slots.',
  minPlayers: 1,
  maxPlayers: 20,
  tickRate: 30,
  teams: [
    { id: 'red', name: 'Red', color: '#e5484d' },
    { id: 'blue', name: 'Blue', color: '#3e8ef7' },
  ],
  settings: {
    timeLimit: { label: 'Time limit', default: 15, min: 3, max: 60, unit: 'min' },
    captureSeconds: { label: 'Capture time (1 player)', default: CAPTURE.seconds, min: 3, max: 40, unit: 's' },
    fillBots: { label: 'Fill empty slots with bots', default: true },
    botDifficulty: { label: 'Bot difficulty', default: 'normal', options: [{ value: 'easy', label: 'Easy' }, { value: 'normal', label: 'Normal' }, { value: 'hard', label: 'Hard' }] },
    ...SHOOTER_SETTINGS,
  },
  scoreboard: [
    { key: 'captures', label: 'Caps' },
    { key: 'defends', label: 'Defends' },
    { key: 'kills', label: 'Kills' },
    { key: 'deaths', label: 'Deaths' },
  ],
  controls: SHOOTER_CONTROLS,
  // The lobby fills both teams to 10 with bots when the match starts (see `autoFill` below).
  autoFill: { setting: 'fillBots', perTeam: 10, difficultySetting: 'botDifficulty' },

  create(ctx) {
    const { settings } = ctx;
    let timeLimit = settings.timeLimit * 60; // grows with every capture (bonus time)
    const capRate = 1 / settings.captureSeconds; // progress per second for one player
    let timeUp = false;
    const setbackUntil = { red: -Infinity, blue: -Infinity }; // faster respawns after losing a point

    // Point state. progress: 0..1 toward `capTeam` taking it (or, for an owned point, toward
    // neutralizing it when capTeam is the other team).
    const points = MAP.points.map((p) => ({
      id: p.id,
      label: p.label,
      pos: p.pos,
      base: p.base ?? null,
      owner: p.base ?? p.owner ?? null,
      capTeam: null,
      progress: 0,
      contested: false,
      cappers: { red: 0, blue: 0 },
    }));
    const capIdx = points.map((p, i) => (p.base ? -1 : i)).filter((i) => i >= 0);
    const countOwned = (team) => capIdx.filter((i) => points[i].owner === team).length;

    /** Can `team` capture point i? Only if it doesn't own it and owns a neighbour. */
    function capturable(i, team) {
      const p = points[i];
      if (p.base || p.owner === team) return false;
      return points[i - 1]?.owner === team || points[i + 1]?.owner === team;
    }

    function onPoint(st, p) {
      const dx = st.pos[0] - p.pos[0];
      const dz = st.pos[2] - p.pos[2];
      return dx * dx + dz * dz <= CAPTURE.radius * CAPTURE.radius && Math.abs(st.pos[1] - p.pos[1]) <= CAPTURE.height;
    }

    /** Overtime: time is up but a capture is still in progress, so the match carries on. */
    function overtime() {
      return ctx.time >= timeLimit && capIdx.some((i) => points[i].progress > 0 && points[i].capTeam);
    }

    function harmonic(n) {
      let s = 0;
      for (let k = 1; k <= n; k++) s += 1 / k;
      return Math.min(CAPTURE.maxRate, s);
    }

    function captured(i, team, by) {
      const p = points[i];
      const prev = p.owner;
      p.owner = team;
      p.capTeam = null;
      p.progress = 0;
      for (const id of by) ctx.addStat(id, 'captures');
      timeLimit += CAPTURE.bonusSeconds;
      if (prev) setbackUntil[prev] = ctx.time + CAPTURE.setbackSeconds;
      ctx.setTeamScore('red', countOwned('red'));
      ctx.setTeamScore('blue', countOwned('blue'));
      ctx.broadcast('point', { event: 'captured', id: p.id, team, prev, by, bonus: CAPTURE.bonusSeconds });
      if (countOwned(team) === capIdx.length) {
        const name = ctx.teams.find((t) => t.id === team)?.name ?? team;
        ctx.endMatch({ winner: team, text: `${name} captured every point!` });
      }
    }

    function neutralized(i, by) {
      const p = points[i];
      const prev = p.owner;
      p.owner = null;
      ctx.setTeamScore(prev, countOwned(prev));
      setbackUntil[prev] = ctx.time + CAPTURE.setbackSeconds;
      ctx.broadcast('point', { event: 'neutralized', id: p.id, prev, team: p.capTeam, by });
    }

    function updatePoints(dt) {
      const { states } = shooter;
      for (const i of capIdx) {
        const p = points[i];
        const on = { red: [], blue: [] };
        for (const st of states.values()) if (st.alive && onPoint(st, p)) on[st.team].push(st);
        p.cappers = { red: on.red.length, blue: on.blue.length };
        const canRed = capturable(i, 'red');
        const canBlue = capturable(i, 'blue');
        // Owners standing on their own point defend it (and stop the capture).
        const attackers = canRed && on.red.length ? 'red' : canBlue && on.blue.length ? 'blue' : null;
        p.contested = Boolean(attackers && on[other(attackers)].length > 0);

        if (attackers && !p.contested) {
          if (p.capTeam !== attackers) {
            // A different team starts capping: progress toward the other team is lost first.
            if (p.progress > 0) {
              p.progress = Math.max(0, p.progress - harmonic(on[attackers].length) * capRate * dt);
              if (p.progress > 0) continue;
            }
            p.capTeam = attackers;
          }
          p.progress = Math.min(1, p.progress + harmonic(on[attackers].length) * capRate * dt);
          if (p.progress >= 1) {
            const by = on[attackers].map((s) => s.id);
            if (p.owner) {
              neutralized(i, by);
              p.progress = 0; // keep capTeam: they carry straight on capturing it
            } else {
              captured(i, attackers, by);
            }
          }
        } else if (p.contested) {
          // Defenders who stop a capture get credit for it, once per second of contesting.
          p.defendTimer = (p.defendTimer ?? 0) + dt;
          if (p.defendTimer >= 1) {
            p.defendTimer = 0;
            const defenders = on[other(attackers)];
            if (p.owner && p.owner === other(attackers)) for (const s of defenders) ctx.addStat(s.id, 'defends');
          }
        } else if (p.progress > 0) {
          p.progress = Math.max(0, p.progress - CAPTURE.decayPerSecond * dt);
          if (p.progress === 0) p.capTeam = null;
        }
      }
    }

    // Enemies inside your spawn rooms take damage, so spawns can't be camped.
    function updateSpawnZones(dt) {
      for (const st of shooter.states.values()) {
        if (!st.alive) continue;
        const enemyZones = MAP.zones[other(st.team)];
        if (!enemyZones.some((z) => pointInAABB(st.pos, z))) continue;
        st.zoneDamage = (st.zoneDamage ?? 0) + SPAWN_ZONE_DPS * dt;
        if (st.zoneDamage >= 1) {
          const dmg = Math.floor(st.zoneDamage);
          st.zoneDamage -= dmg;
          st.hp = Math.max(0, st.hp - dmg);
          st.lastDamageAt = ctx.time;
          ctx.send(st.id, 'hurt', { from: null, amount: dmg, hp: st.hp, zone: true });
          if (st.hp <= 0) shooter.kill(st, null, { cause: 'zone' });
        }
      }
    }

    const shooter = createShooter(ctx, {
      map: MAP,
      respawnTime(st) {
        // The team that has pushed further waits longer, giving the other side a window to push back.
        const lead = countOwned(st.team) - countOwned(other(st.team));
        let mul = 1 + lead * CAPTURE.respawnPerPointLead;
        if (ctx.time < setbackUntil[st.team]) mul *= CAPTURE.setbackRespawnMul;
        return Math.max(1, settings.respawnTime * mul);
      },
      // Spawn at the forward room while your team holds its second point.
      pickSpawn(st, defaultPick) {
        const fi = MAP.forwardSpawnPoint[st.team];
        return points[fi].owner === st.team ? defaultPick(st.team, MAP.forwardSpawns[st.team]) : defaultPick(st.team);
      },
      snapshotExtra() {
        return {
          points: points.map((p) => ({
            id: p.id,
            o: p.owner,
            c: p.capTeam,
            p: Math.round(p.progress * 1000) / 1000,
            x: p.contested ? 1 : 0,
            n: [p.cappers.red, p.cappers.blue],
            ok: [capturable(points.indexOf(p), 'red') ? 1 : 0, capturable(points.indexOf(p), 'blue') ? 1 : 0],
          })),
          timeLeft: Math.max(0, Math.ceil(timeLimit - ctx.time)),
          ot: overtime() ? 1 : 0,
        };
      },
      tick(dt) {
        updatePoints(dt);
        updateSpawnZones(dt);
        if (!timeUp && ctx.time >= timeLimit && !overtime()) timeUp = endOnTime(ctx, countOwned, (n) => `${n} point${n === 1 ? '' : 's'}`);
      },
    });

    ctx.setTeamScore('red', countOwned('red'));
    ctx.setTeamScore('blue', countOwned('blue'));
    return { ...shooter.hooks, debugPoints: () => points };
  },
});
