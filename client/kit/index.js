// Everything a game's client/index.js typically needs:
//   import { defineClientGame, Input, sfx, History, v3 } from '/client/kit/index.js';
// three.js helpers live separately in '/client/kit/three.js' so 2D games don't load three.

export { Input } from './input.js';
export { sfx } from './sound.js';
export { h, replace, toast } from '../js/dom.js';
export * from '/shared/kit/math.js';
export * from '/shared/kit/history.js';
export * from '/shared/kit/timers.js';
export * from '/shared/kit/physics.js';
export * from '/shared/kit/navgrid.js';

/**
 * Describe a game's browser side.
 *
 *   export default defineClientGame({
 *     mount(api) {
 *       // build your scene inside api.root, HUD inside api.hud
 *       api.on('state', (data) => { ... });   // messages from your server.js
 *       return { destroy() { ... } };          // called when the match ends
 *     },
 *   });
 */
export function defineClientGame(def) {
  if (!def || typeof def.mount !== 'function') throw new Error('defineClientGame() needs a mount(api) function');
  return def;
}
