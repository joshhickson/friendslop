// Starter: an empty room where everyone is a dot that walks around. No rules, no scoring.
// `npm run new-game -- <id>` copies this folder to games/<id>/. Add your game on top of it.
// Shared by a GitHub link, this file runs in the host's browser (in a worker), so the host runs your
// rules and could change the score. Use relative imports only, as below. See docs/making-a-game.md.

import { defineGame, clamp, isNum } from '../../server/kit/index.js';

const SIZE = 40;      // arena is SIZE x SIZE units
const SPEED = 12;     // units per second

export default defineGame({
  id: 'starter',
  name: 'Starter',
  description: 'Everyone is a dot. Walk around. Now make it a game.',
  minPlayers: 1,
  maxPlayers: 12,
  tickRate: 20,
  controls: [['WASD', 'move']],

  create(ctx) {
    const pos = new Map(); // playerId -> { x, y, dx, dy }
    const randomSpot = () => ({ x: 2 + Math.random() * (SIZE - 4), y: 2 + Math.random() * (SIZE - 4) });

    return {
      onPlayerJoin(p) {
        pos.set(p.id, { ...randomSpot(), dx: 0, dy: 0 });
      },
      onPlayerLeave(p) {
        pos.delete(p.id);
      },
      onMessage(p, type, data) {
        // The client only sends its input direction; the server does all movement.
        if (type !== 'input' || !data || !isNum(data.dx) || !isNum(data.dy)) return;
        const s = pos.get(p.id);
        if (s) Object.assign(s, { dx: clamp(data.dx, -1, 1), dy: clamp(data.dy, -1, 1) });
      },
      tick(dt) {
        for (const s of pos.values()) {
          const len = Math.hypot(s.dx, s.dy) || 1;
          s.x = clamp(s.x + (s.dx / len) * SPEED * dt, 0.5, SIZE - 0.5);
          s.y = clamp(s.y + (s.dy / len) * SPEED * dt, 0.5, SIZE - 0.5);
        }
        ctx.broadcast('state', {
          size: SIZE,
          players: [...pos].map(([id, s]) => ({ id, x: Math.round(s.x * 100) / 100, y: Math.round(s.y * 100) / 100 })),
        });
      },
    };
  },
});
