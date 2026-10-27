// Test-only game: two teams of dots. Red spawns on the left (x < 0), blue on the right (x > 0).
// Exists so the framework, bot and spectating tests have a team game to run against.

import { defineGame, clamp, isNum } from '../../../../server/kit/index.js';

const HALF = 20;
const SPEED = 10;

export default defineGame({
  id: 'dots',
  name: 'Dots',
  description: 'Test game: two teams of dots.',
  minPlayers: 1,
  maxPlayers: 12,
  tickRate: 20,
  teams: [
    { id: 'red', name: 'Red', color: '#e5484d' },
    { id: 'blue', name: 'Blue', color: '#3e8ef7' },
  ],
  settings: {
    scoreLimit: { label: 'Points to win', default: 10, min: 1, max: 50 },
    timeLimit: { label: 'Time limit', default: 10, min: 1, max: 60, unit: 'min' },
  },
  scoreboard: [{ key: 'points', label: 'Points' }],

  create(ctx) {
    const pos = new Map(); // playerId -> { pos: [x, y, z], dx, dz }
    const spawn = (p) => {
      const side = p.team === 'blue' ? 1 : -1;
      const s = { pos: [side * (5 + Math.random() * 10), 0, (Math.random() - 0.5) * 20], dx: 0, dz: 0 };
      pos.set(p.id, s);
      ctx.send(p, 'spawn', { pos: s.pos });
    };

    return {
      onPlayerJoin: spawn,
      onTeamChange: spawn,
      onPlayerLeave(p) {
        pos.delete(p.id);
      },
      onMessage(p, type, data) {
        if (type !== 'input' || !data || !isNum(data.dx) || !isNum(data.dy)) return;
        const s = pos.get(p.id);
        if (s) Object.assign(s, { dx: clamp(data.dx, -1, 1), dz: clamp(data.dy, -1, 1) });
      },
      tick(dt) {
        for (const s of pos.values()) {
          const len = Math.hypot(s.dx, s.dz) || 1;
          s.pos[0] = clamp(s.pos[0] + (s.dx / len) * SPEED * dt, -HALF, HALF);
          s.pos[2] = clamp(s.pos[2] + (s.dz / len) * SPEED * dt, -HALF, HALF);
        }
        ctx.broadcast('state', { players: [...pos].map(([id, s]) => ({ id, pos: s.pos })) });
      },
      debugState(id) {
        return pos.get(id);
      },
    };
  },
});
