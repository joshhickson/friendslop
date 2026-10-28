// Control Points map "Five Gates", as plain data shared by server, browser and bots.
//
// An 80 x 260 rectangle. Red's base is at -Z, Blue's at +Z. Five capture points (A..E) run down
// the middle; between each pair a wall crosses the map, broken by three routes: a main gate, a
// narrow flank alley, and a raised walkway reached by stairs (high ground that drops down on the
// far side). Each team has an enclosed base spawn plus a forward spawn room that is used while the
// team holds its second point.
//
// Only the red half is described below. Every piece is mirrored (x -> -x, z -> -z) onto the blue
// half, so both sides are identical. Pieces sitting on z = 0 use { mirror: false }.
// Boxes stand on the floor and never overhang each other, so bots' pathfinding can treat the
// level as a heightfield. Imports are relative so this file works in Node and in the browser.

// friendslop's Blockout look: a paper-grey floor ruled like graph paper, light blocks outlined in
// ink, orange crates, and the teams' red and blue on their own walls.
const C = {
  ground: '#c9c7be',
  wall: '#e6e3d9',
  stone: '#d6d3c9',
  stoneDark: '#aeaa9f',
  step: '#efece4',
  crate: '#f28c28',
  crateDark: '#c96d1a',
  red: '#d93a2b',
  redWall: '#e58a7f',
  blue: '#2e5bd8',
  blueWall: '#8aa3ea',
  ink: '#22201c',
  grid: '#a29e93',
};

const boxes = [];

/** Box from center + size (y is the box center). */
function add(cx, cy, cz, w, h, d, color, { mirror = true, mirrorColor } = {}) {
  boxes.push({ min: [cx - w / 2, cy - h / 2, cz - d / 2], max: [cx + w / 2, cy + h / 2, cz + d / 2], color });
  if (mirror) boxes.push({ min: [-cx - w / 2, cy - h / 2, -cz - d / 2], max: [-cx + w / 2, cy + h / 2, -cz + d / 2], color: mirrorColor ?? color });
}

/** Box standing on the floor, by its x/z extents. */
function block(x0, x1, z0, z1, h, color, opts) {
  add((x0 + x1) / 2, h / 2, (z0 + z1) / 2, x1 - x0, h, z1 - z0, color, opts);
}

/** Box standing on the floor, by center x/z and size. */
function piece(cx, cz, w, h, d, color, opts) {
  add(cx, h / 2, cz, w, h, d, color, opts);
}

/** Stairs down from a platform of `height`, starting at its edge zEdge and stepping in direction dz (+1/-1). */
function stairsZ(x0, x1, zEdge, dz, height, color = C.step) {
  for (let k = 1; k * 0.5 < height; k++) {
    const a = zEdge + dz * (k - 1);
    const b = zEdge + dz * k;
    block(x0, x1, Math.min(a, b), Math.max(a, b), height - k * 0.5, color);
  }
}

/** Same, stepping along x. */
function stairsX(z0, z1, xEdge, dx, height, color = C.step) {
  for (let k = 1; k * 0.5 < height; k++) {
    const a = xEdge + dx * (k - 1);
    const b = xEdge + dx * k;
    block(Math.min(a, b), Math.max(a, b), z0, z1, height - k * 0.5, color);
  }
}

const HX = 40; // half width
const HZ = 130; // half length

// ---- floor + outer walls ---------------------------------------------------------
add(0, -0.5, 0, HX * 2 + 2, 1, HZ * 2 + 2, C.ground, { mirror: false });
block(-HX - 1, -HX, -HZ - 1, HZ + 1, 10, C.wall, { mirror: false });
block(HX, HX + 1, -HZ - 1, HZ + 1, 10, C.wall, { mirror: false });
block(-HX - 1, HX + 1, -HZ - 1, -HZ, 10, C.red, { mirrorColor: C.blue });

// ---- Red base (spawn) z -130..-105 --------------------------------------------------
// Front wall with three exits: a wide main door and two side doors.
for (const [x0, x1] of [[-40, -29], [-23, -5], [5, 23], [29, 40]]) block(x0, x1, -107, -105, 9, C.redWall, { mirrorColor: C.blueWall });
block(-3, 3, -123, -117, 0.5, C.red, { mirrorColor: C.blue }); // the base's own (uncapturable) point

// ---- A: red's last point, z -105..-66 ------------------------------------------------
// Point A sits on a two-step stone dais (floor y = 1).
for (const [x0, x1, z0, z1] of [[-7, 7, -93, -91], [-7, 7, -81, -79], [-7, -5, -91, -81], [5, 7, -91, -81]]) block(x0, x1, z0, z1, 0.5, C.stoneDark);
block(-5, 5, -91, -81, 1, C.stone);
piece(-8, -77, 6, 1.2, 1, C.crateDark); // low walls: cover while capping
piece(8, -95, 6, 1.2, 1, C.crateDark);
piece(-13, -90, 2, 4, 2, C.stone); // pillars
piece(13, -82, 2, 4, 2, C.stone);
piece(24, -92, 3, 2, 3, C.crate);
piece(30, -81, 2, 1.2, 2, C.crateDark);
piece(-20, -74, 2, 2, 2, C.crate);
// Defenders' perch: high ground beside the base, overlooking the point.
block(-38, -30, -104, -94, 3, C.stone);
stairsZ(-38, -30, -94, 1, 3);

// ---- Gate 1 (A <-> B), wall at z -66..-64 ---------------------------------------------
// Routes: left flank alley (x -40..-35), main gate (x -5..5), right walkway over the wall (x 24..34).
for (const [x0, x1] of [[-34, -5], [5, 24], [34, 40]]) block(x0, x1, -66, -64, 8, C.wall);
block(-35, -34, -72, -58, 8, C.wall); // alley wall
block(-3, 3, -74, -72.5, 1.4, C.crateDark); // breaks the line of sight through the main gate (walk round it)
block(24, 34, -72, -58, 3, C.stone); // walkway
stairsZ(24, 34, -72, -1, 3);
stairsZ(24, 34, -58, 1, 3);

// ---- B: red's second point, z -64..-26 ------------------------------------------------
// A roofless stone house around the point: doors on every side, walls too tall to jump.
for (const [x0, x1] of [[-10, -3], [3, 10]]) block(x0, x1, -52, -51, 4, C.stoneDark);
for (const [x0, x1] of [[-10, -8], [-4, 4], [8, 10]]) block(x0, x1, -39, -38, 4, C.stoneDark);
for (const [z0, z1] of [[-51, -47], [-43, -39]]) {
  block(-10, -9, z0, z1, 4, C.stoneDark);
  block(9, 10, z0, z1, 4, C.stoneDark);
}
piece(-18, -56, 2, 2, 2, C.crate);
piece(-22, -44, 3, 1.4, 1.4, C.crateDark);
piece(-17, -33, 5, 1.2, 1, C.crateDark);
piece(17, -30, 4, 1.2, 1, C.crateDark);
piece(18, -55, 2, 1.4, 2, C.crate);
piece(-14, -60, 1.6, 3.5, 1.6, C.stone);
// Red's forward spawn room (used while red holds B). Exits face the house and gate 1.
block(26, 27, -46, -42, 6, C.redWall, { mirrorColor: C.blueWall });
block(26, 27, -38, -34, 6, C.redWall, { mirrorColor: C.blueWall });
block(27, 31, -46, -45, 6, C.redWall, { mirrorColor: C.blueWall });
block(35, 40, -46, -45, 6, C.redWall, { mirrorColor: C.blueWall });
block(27, 40, -35, -34, 6, C.redWall, { mirrorColor: C.blueWall });

// ---- Gate 2 (B <-> C), wall at z -26..-24 ---------------------------------------------
// Routes: left walkway (x -34..-24), two doors either side of a solid centre, right flank alley (x 35..40).
for (const [x0, x1] of [[-40, -34], [-24, -14], [-8, 8], [14, 34]]) block(x0, x1, -26, -24, 8, C.wall);
block(34, 35, -32, -18, 8, C.wall); // alley wall
block(-34, -24, -32, -18, 3, C.stone); // walkway
stairsZ(-34, -24, -32, -1, 3);
stairsZ(-34, -24, -18, 1, 3);

// ---- C: the middle point, z -24..24 -----------------------------------------------------
// Point C sits on a two-step stone dais (floor y = 1), with low cover walls at its edges.
for (const [x0, x1, z0, z1] of [[-7, 7, -7, -5], [-7, 7, 5, 7], [-7, -5, -5, 5], [5, 7, -5, 5]]) block(x0, x1, z0, z1, 0.5, C.stoneDark, { mirror: false });
block(-5, 5, -5, 5, 1, C.stone, { mirror: false });
piece(-9, -2.5, 1, 1.2, 4, C.crateDark); // mirrored to (9, 2.5)
// High ground on the flanks of mid (the mirror puts one on the other side, facing the other way).
block(-30, -20, -6, 6, 3, C.stone);
stairsZ(-30, -20, -6, -1, 3);
stairsX(-3, 3, -20, 1, 3);
piece(-12, -14, 2, 2, 2, C.crate);
piece(10, -12, 3, 1.4, 1.4, C.crateDark);
piece(14, -19, 1.6, 3.5, 1.6, C.stone);
piece(-5, -17, 5, 1.2, 1, C.crateDark);
piece(-37, -10, 2, 2, 2, C.crate);

const mirrorPos = ([x, y, z]) => [-x, y, -z];
const mirrorZone = (zone) => ({ min: [-zone.max[0], zone.min[1], -zone.max[2]], max: [-zone.min[0], zone.max[1], -zone.min[2]] });
const redSpawns = (list, yaw) => list.map((pos) => ({ pos, yaw }));
const blueSpawns = (list) => list.map(({ pos, yaw }) => ({ pos: mirrorPos(pos), yaw: yaw + Math.PI }));

// Base spawns face the field (+Z for red). Forward spawn rooms face their exits (-X for red).
const RED_BASE = redSpawns([
  [-30, 0, -126], [-20, 0, -126], [-10, 0, -126], [10, 0, -126], [20, 0, -126], [30, 0, -126],
  [-30, 0, -113], [-20, 0, -113], [-10, 0, -113], [10, 0, -113], [20, 0, -113], [30, 0, -113],
], Math.PI);
const RED_FORWARD = redSpawns([
  [29.5, 0, -37], [29.5, 0, -43], [33, 0, -40], [36.5, 0, -37], [36.5, 0, -43], [38.5, 0, -40], [33, 0, -36.5], [33, 0, -43.5],
], Math.PI / 2);

// Spawn areas: enemies standing in them take damage (stops spawn camping); bots avoid them.
const RED_ZONES = [
  { min: [-40, -10, -130], max: [40, 20, -105] },
  { min: [27, -10, -45], max: [40, 20, -35] },
];

export const CP_MAP = {
  name: 'Five Gates',
  bounds: { min: [-HX, -5, -HZ], max: [HX, 40, HZ] },
  boxes,
  sky: '#f3f1ea',
  edges: C.ink,
  ambient: 0.7,
  grid: { color: C.grid, step: 4 },
  colors: C,
  navCell: 0.75,
  // The seven points from Red's end to Blue's. The ends are the bases (owned for good).
  points: [
    { id: 'redbase', label: 'Red base', pos: [0, 0.5, -120], base: 'red' },
    { id: 'A', label: 'A', pos: [0, 1, -86], owner: 'red' },
    { id: 'B', label: 'B', pos: [0, 0, -45], owner: 'red' },
    { id: 'C', label: 'C', pos: [0, 1, 0], owner: null },
    { id: 'D', label: 'D', pos: [0, 0, 45], owner: 'blue' },
    { id: 'E', label: 'E', pos: [0, 1, 86], owner: 'blue' },
    { id: 'bluebase', label: 'Blue base', pos: [0, 0.5, 120], base: 'blue' },
  ],
  spawns: { red: RED_BASE, blue: blueSpawns(RED_BASE) },
  forwardSpawns: { red: RED_FORWARD, blue: blueSpawns(RED_FORWARD) },
  // Which capture point (index into `points`) keeps each team's forward spawn open.
  forwardSpawnPoint: { red: 2, blue: 4 },
  zones: { red: RED_ZONES, blue: RED_ZONES.map(mirrorZone) },
  // Walls crossing the map and the gaps in them (used to spread bots across the routes).
  gates: [
    { z: -106, doors: [[-26, -106], [0, -106], [26, -106]] },
    { z: -65, doors: [[-37.5, -65], [0, -65], [29, -65]] },
    { z: -25, doors: [[-29, -25], [-11, -25], [11, -25], [37.5, -25]] },
  ].flatMap((g) => [g, { z: -g.z, doors: g.doors.map(([x, z]) => [-x, -z]) }]).sort((a, b) => a.z - b.z),
};
