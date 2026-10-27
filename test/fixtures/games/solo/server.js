// Test-only game: free-for-all with no teams and no bot.js. Broadcasts its tick count.

import { defineGame } from '../../../../server/kit/index.js';

export default defineGame({
  id: 'solo',
  name: 'Solo',
  description: 'Test game: no teams, no bots.',
  minPlayers: 1,
  maxPlayers: 8,
  tickRate: 20,
  settings: {
    target: { label: 'Points to win', default: 15, min: 3, max: 100 },
  },
  scoreboard: [{ key: 'points', label: 'Points' }],

  create(ctx) {
    return {
      tick() {
        ctx.broadcast('state', { tick: ctx.tick, players: ctx.players().map((p) => p.id) });
      },
    };
  },
});
