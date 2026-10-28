// Control Points tuning. The shooter basics (movement, weapon, health, netcode) are shared by every shooter mode.

export { MOVE, BODY, HITBOX, WEAPON, PLAYER, NET } from '../../_shooter/shared/constants.js';

export const CAPTURE = {
  radius: 5,              // how close (horizontally) you must stand to a point to count
  height: 4,              // ...and within this height of its floor
  seconds: 10,            // time for ONE player to capture a point from neutral (100%)
  // Each extra player speeds a capture up, with diminishing returns:
  // capture rate = 1 + 0.5 + 0.33 + 0.25 + ... (harmonic), capped at `maxRate`.
  maxRate: 3,
  decayPerSecond: 0.1,    // progress lost per second (fraction) when nobody is capturing
  contestHold: true,      // both teams on a point: progress freezes
  bonusSeconds: 60,       // added to the clock on every capture
  setbackSeconds: 30,     // after losing a point, the team respawns faster for this long...
  setbackRespawnMul: 0.5, // ...at this fraction of the normal wait
  // Attackers need a window to push, so respawn waits scale with how far a team has pushed:
  // the team that owns more points waits longer. Each point owned beyond an even split adds
  // this fraction of the base wait (and the team that owns fewer waits that much less).
  respawnPerPointLead: 0.15,
};
