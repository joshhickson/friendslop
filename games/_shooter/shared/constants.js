// Tuning values shared by every shooter mode (server, browser and bots). Tweak freely while playtesting.
// Mode-specific values (flags, capture points) live in each mode's own shared/constants.js.

export const MOVE = {
  runSpeed: 7,
  groundAccel: 14,      // how quickly you reach target speed on the ground (per second)
  airAccel: 2.5,
  jumpVelocity: 8,
  gravity: 22,
  eyeHeight: 1.6,
};

export const BODY = { radius: 0.4, height: 1.8, stepHeight: 0.55 };

// Hitboxes relative to the feet position.
export const HITBOX = {
  body: { radius: 0.42, bottom: 0, top: 1.42 },
  head: { radius: 0.27, bottom: 1.42, top: 1.92 },
};

export const WEAPON = {
  name: 'Rifle',
  damage: 22,
  headshotMul: 2,
  fireInterval: 0.11, // seconds between shots (automatic)
  magSize: 24,
  reloadTime: 1.6,
  range: 120,
  spread: 0.006,      // radians of random spread (client-side, cosmetic recoil feel)
};

export const PLAYER = {
  maxHealth: 100,
  spawnProtection: 1.5, // seconds of invulnerability after spawning
  regenDelay: 5,        // seconds without damage before regen kicks in
  regenPerSecond: 12,
};

export const NET = {
  inputHz: 30,          // client -> server movement updates
  snapshotHz: 20,       // server -> clients world state
  interpDelayMs: 100,   // how far in the past remote players are rendered
  maxRewindMs: 300,     // lag-compensation cap
};
