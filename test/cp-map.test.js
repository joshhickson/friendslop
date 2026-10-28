import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CP_MAP as MAP } from '../games/cp/shared/map.js';

// Control Points bots pick a door in each wall by their place in the team (games/cp/bot.js), so
// the two teams only spread the same way if every wall's doors are listed as mirror images.
test("Control Points: each wall's doors mirror the matching wall on the other half", () => {
  for (const gate of MAP.gates) {
    const twin = MAP.gates.find((g) => g.z === -gate.z);
    assert.ok(twin, `wall at z ${gate.z} has a twin`);
    assert.deepEqual(twin.doors, gate.doors.map(([x, z]) => [-x, -z]));
  }
});

test('Control Points: every box on one half has a mirror image on the other', () => {
  const key = (b) => [...b.min, ...b.max].map((n) => n.toFixed(3)).join(',');
  const all = new Set(MAP.boxes.map(key));
  for (const b of MAP.boxes) {
    const m = { min: [-b.max[0], b.min[1], -b.max[2]], max: [-b.min[0], b.max[1], -b.min[2]] };
    assert.ok(all.has(key(m)), `box ${key(b)} has a mirror`);
  }
});
