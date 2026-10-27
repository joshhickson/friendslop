// Everything a game's server.js needs, in one import:
//   import { defineGame, v3, History, Cooldown } from '../../server/kit/index.js';

// Bump when the kit's API changes in a way an older game cannot follow; the runner compares it to a game's own.
export const KIT_VERSION = 1;

export { defineGame } from './defineGame.js';
export * from '../../shared/kit/math.js';
export * from '../../shared/kit/history.js';
export * from '../../shared/kit/timers.js';
export * from '../../shared/kit/physics.js';
export * from '../../shared/kit/navgrid.js';
