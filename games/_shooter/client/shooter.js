// Shared browser client for first-person team shooter modes (CTF, Control Points, ...).
//
// - Local player: movement is predicted here (same physics as the server) and sent ~30x/s.
// - Remote players: rendered from server snapshots, ~100ms in the past, interpolated.
// - Shots: sent with the server time the shooter was seeing, so the server can rewind targets.
// - Dead or spectating: follow cam (a live player's view) or a noclip free camera.
//
// A mode mounts it and adds its objective:
//
//   const game = mountShooter(api, {
//     map,                               // { boxes, bounds, sky, ... }
//     fog: [near, far],                  // optional view distance
//     speedMul: () => number,            // optional: local movement multiplier (e.g. flag carrier)
//     onSnapshot(snap) {},               // objective state from the server's snapshotExtra()
//     frame(dt, t) {},                   // per-frame objective rendering
//     destroy() {},
//   });
//   // game.scene, game.hud, game.remotes, game.me, game.myTeam(), game.fx, game.span(text, color)

import { Input, sfx, History, moveCharacter, dirFromYawPitch, lerp, lerpAngle, clamp, raycastBoxes } from '/client/kit/index.js';
import { THREE, createStage, loop, buildBoxWorld, makeCharacter, textSprite, tracer, burst, Effects, box, flatMat } from '/client/kit/three.js';
import { MOVE, BODY, WEAPON, NET, PLAYER } from '../shared/constants.js';
import { createHud } from './hud.js';

const MOUSE_SENS = 0.0022;
const DEATH_CAM_SECONDS = 2.5;

export function mountShooter(api, mode) {
  const MAP = mode.map;
  const stage = createStage(api.root, { background: MAP.sky, fog: mode.fog ?? [50, 140] });
  const { scene, camera } = stage;
  camera.far = Math.max(500, (mode.fog?.[1] ?? 140) * 1.2);
  camera.updateProjectionMatrix();
  scene.add(camera);
  buildBoxWorld(scene, MAP.boxes);
  const input = new Input(api, stage.canvas);
  const hud = createHud(api);
  const fx = new Effects();

  // ---------- first-person viewmodel ----------
  const viewmodel = new THREE.Group();
  const gunBody = box(0.09, 0.11, 0.55, '#2b2b2b');
  const gunStripe = box(0.095, 0.03, 0.3, '#888');
  gunStripe.position.set(0, 0.05, 0.05);
  const muzzle = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.05), new THREE.MeshBasicMaterial({ color: '#ffe680' }));
  muzzle.position.set(0, 0, -0.3);
  muzzle.visible = false;
  viewmodel.add(gunBody, gunStripe, muzzle);
  viewmodel.position.set(0.22, -0.2, -0.45);
  camera.add(viewmodel);

  // ---------- local player state ----------
  const me = {
    life: 0,
    alive: false,
    hp: PLAYER.maxHealth,
    pos: [0, 0, 0],
    vel: [0, 0, 0],
    onGround: false,
    yaw: 0,
    pitch: 0,
    ammo: WEAPON.magSize,
    reloadingUntil: 0,
    nextShotAt: 0,
    lastShotAt: 0,
    respawnIn: 0,
    killer: null,
    deathCam: null,
  };
  let myTeam = api.player()?.team ?? 'red';
  let recoil = 0;
  let sendAccum = 0;
  let timeNow = 0;

  // ---------- spectator camera ----------
  // Used while dead (after a short death cam) and when spectating by choice.
  // 'follow': look through a live player's eyes. 'free': noclip flying camera.
  const spec = { mode: 'follow', target: null, pos: [0, 12, -20], yaw: Math.PI, pitch: -0.35 };
  const isSpectating = () => api.spectating || (!me.alive && me.deathCam && me.deathCam.t >= DEATH_CAM_SECONDS);

  // The first-person gun shows your own gun, or the gun of the player you're watching in follow
  // mode (stripe in their team color).
  let stripeTeam = null;
  function setStripeColor(team = myTeam) {
    if (team === stripeTeam) return;
    stripeTeam = team;
    gunStripe.material = flatMat(api.teamColor(team));
  }
  setStripeColor();
  // Recoil/flash for the watched player's gun. Their shots arrive in real time, but they're drawn
  // NET.interpDelayMs in the past, so the kick is queued to line up with what you see.
  let watchedShots = [];
  let watchedLastShot = -Infinity;

  // ---------- remote players ----------
  const remotes = new Map(); // id -> { char, label, history, team, name, pitch }
  const lerpSample = (a, b, t) => {
    // Never blend across a respawn: that would draw the player sliding from where they died
    // to their spawn. Hold the earlier sample (dead, hidden) until the respawn's own sample is due.
    if (a.life !== b.life) return a;
    return {
      pos: [lerp(a.pos[0], b.pos[0], t), lerp(a.pos[1], b.pos[1], t), lerp(a.pos[2], b.pos[2], t)],
      yaw: lerpAngle(a.yaw, b.yaw, t),
      pitch: lerp(a.pitch, b.pitch, t),
      alive: a.alive && b.alive,
      life: b.life,
    };
  };

  function ensureRemote(id, team) {
    let r = remotes.get(id);
    const name = api.player(id)?.name ?? '???';
    if (!r) {
      const char = makeCharacter(api.teamColor(team));
      scene.add(char.group);
      r = { char, label: null, history: new History(1000, lerpSample), team: null, name: null };
      remotes.set(id, r);
    }
    if (r.team !== team || r.name !== name) {
      r.team = team;
      r.name = name;
      r.char.setColor(api.teamColor(team));
      if (r.label) {
        r.char.group.remove(r.label);
        r.label.material.map.dispose();
        r.label.material.dispose();
      }
      r.label = textSprite(name, { color: api.teamColor(team) });
      r.label.position.y = 2.25;
      r.char.group.add(r.label);
    }
    return r;
  }

  function removeRemote(id) {
    const r = remotes.get(id);
    if (!r) return;
    scene.remove(r.char.group);
    if (r.label) {
      r.label.material.map.dispose();
      r.label.material.dispose();
    }
    remotes.delete(id);
  }

  // ---------- network: world state ----------
  let lastSnapTime = 0;

  function applySnapshot(snap) {
    if (snap.t <= lastSnapTime) return;
    lastSnapTime = snap.t;
    const seen = new Set();
    for (const [id, x, y, z, yaw, pitch, hp, alive, team, life] of snap.players) {
      if (id === api.me) {
        myTeam = team; // the viewmodel picks up the new stripe color next frame
        continue;
      }
      seen.add(id);
      const r = ensureRemote(id, team);
      r.history.push(snap.t, { pos: [x, y, z], yaw, pitch, alive: Boolean(alive), life });
      r.hp = hp;
    }
    for (const id of remotes.keys()) if (!seen.has(id)) removeRemote(id);
    if (snap.timeLeft !== undefined) hud.setTime(snap.timeLeft);
    mode.onSnapshot?.(snap);
  }

  api.on('init', ({ snapshot, spectating }) => {
    applySnapshot(snapshot);
    if (spectating) {
      me.alive = false;
      me.deathCam = null;
      hud.setDead(false);
    }
  });
  api.on('snap', applySnapshot);
  api.on('gone', ({ id }) => removeRemote(id));

  api.on('spawn', (data) => {
    me.life = data.life;
    me.alive = true;
    me.hp = data.hp;
    me.pos = [...data.pos];
    me.vel = [0, 0, 0];
    me.yaw = data.yaw;
    me.pitch = 0;
    me.ammo = data.ammo;
    me.reloadingUntil = 0;
    me.deathCam = null;
    hud.setDead(false);
    hud.setHealth(me.hp);
  });

  api.on('correct', ({ life, pos }) => {
    if (life !== me.life) return;
    me.pos = [...pos];
    me.vel = [0, 0, 0];
  });

  api.on('self', (s) => {
    if (s.life < me.life) return;
    // Rejoining while dead (refresh, or back from spectating) resumes the countdown.
    if (s.life > me.life) me.life = s.life;
    me.hp = s.hp;
    hud.setHealth(s.hp);
    if (!s.alive && me.alive) die(null);
    if (!s.alive && !me.deathCam) me.deathCam = { pos: [spec.pos[0], spec.pos[1], spec.pos[2]], t: DEATH_CAM_SECONDS };
    me.respawnIn = s.respawnIn;
    // Trust the server's ammo count when we haven't fired recently.
    if (timeNow - me.lastShotAt > 0.5 && timeNow > me.reloadingUntil) me.ammo = s.ammo;
  });

  // ---------- network: events ----------
  api.on('shot', ({ by, from, to, hit }) => {
    const r = remotes.get(by);
    const color = api.teamColor(r?.team);
    if (isSpectating() && spec.mode === 'follow' && spec.target === by) watchedShots.push(timeNow + NET.interpDelayMs / 1000);
    fx.add(tracer(scene, from, to, color, 0.07));
    if (!hit) fx.add(burst(scene, to, { color: '#ddd', count: 4, speed: 2, life: 0.25, size: 0.05 }));
    const ear = camera.position;
    const d = Math.hypot(from[0] - ear.x, from[2] - ear.z);
    if (d < 70) sfx.play('shoot', { volume: clamp(1 - d / 70, 0.05, 0.6), pitch: 0.9 });
  });

  api.on('hitConfirm', ({ headshot, kill }) => {
    hud.hit(kill ? 'kill' : headshot ? 'head' : '');
    sfx.play(kill ? 'kill' : 'hit', { volume: 0.6, pitch: headshot ? 1.4 : 1 });
  });

  api.on('hurt', ({ hp }) => {
    me.hp = hp;
    hud.setHealth(hp);
    hud.hurt();
    sfx.play('hurt', { volume: 0.5 });
  });

  function die(killer) {
    me.alive = false;
    me.killer = killer;
    me.deathCam = { pos: [me.pos[0], me.pos[1] + MOVE.eyeHeight, me.pos[2]], t: 0 };
    // After the death cam, watch your killer if there is one, otherwise someone else.
    spec.mode = 'follow';
    spec.target = killer && killer !== api.me ? killer : null;
    spec.pos = [...me.deathCam.pos];
    spec.yaw = me.yaw;
    spec.pitch = -0.3;
    input.releaseAll();
    sfx.play('die', { volume: 0.5 });
  }

  api.on('kill', ({ victim, killer, headshot, cause, pos, respawnIn }) => {
    hud.killFeed(killer, victim, headshot, cause);
    const color = api.teamColor(victim === api.me ? myTeam : remotes.get(victim)?.team);
    fx.add(burst(scene, [pos[0], pos[1] + 1, pos[2]], { color, count: 16, speed: 5, life: 0.7, size: 0.15 }));
    if (victim === api.me) {
      if (me.alive) die(killer);
      me.killer = killer;
      me.respawnIn = respawnIn;
      if (cause === 'switch') {
        // No death cam for a team switch: go straight to spectating until the respawn.
        me.deathCam.t = DEATH_CAM_SECONDS;
        hud.announce('Switching teams…', '#fff', 1500);
      } else {
        hud.setDead(true, respawnIn, killer);
      }
    }
  });

  function span(text, color) {
    const s = document.createElement('span');
    s.style.color = color;
    s.textContent = text;
    return s;
  }

  let wasSpectating = api.spectating;
  api.onRoom(() => {
    const p = api.player();
    if (p?.team) myTeam = p.team;
    if (api.spectating && !wasSpectating) {
      // Switched to spectating mid-match: start from the current view, not the death screen.
      me.alive = false;
      me.deathCam = null;
      spec.pos = camera.position.toArray();
      spec.yaw = camera.rotation.y;
      spec.pitch = camera.rotation.x;
      hud.setDead(false);
    }
    wasSpectating = api.spectating;
    // Refresh labels if names/teams changed.
    for (const [id, r] of remotes) ensureRemote(id, r.team);
  });

  // ---------- shooting ----------
  function tryShoot() {
    if (!me.alive || timeNow < me.nextShotAt || timeNow < me.reloadingUntil) return;
    if (me.ammo <= 0) {
      startReload();
      return;
    }
    me.ammo--;
    me.nextShotAt = timeNow + WEAPON.fireInterval;
    me.lastShotAt = timeNow;

    const spread = WEAPON.spread * (me.onGround ? 1 : 3);
    const yaw = me.yaw + (Math.random() - 0.5) * spread * 2;
    const pitch = me.pitch + (Math.random() - 0.5) * spread * 2;
    const dir = dirFromYawPitch(yaw, pitch);
    const origin = [me.pos[0], me.pos[1] + MOVE.eyeHeight, me.pos[2]];
    api.send('shoot', {
      life: me.life,
      o: origin,
      d: dir,
      // The server time at which the remote players we see were actually there.
      t: Math.round(api.serverNow() - NET.interpDelayMs),
    });

    // Local feedback (tracer from the gun, impact on walls).
    const wall = raycastBoxes(origin, dir, MAP.boxes, WEAPON.range);
    const dist = Math.min(wall.dist, WEAPON.range);
    const end = [origin[0] + dir[0] * dist, origin[1] + dir[1] * dist, origin[2] + dir[2] * dist];
    const muzzleWorld = new THREE.Vector3();
    muzzle.getWorldPosition(muzzleWorld);
    fx.add(tracer(scene, muzzleWorld.toArray(), end, '#fff4b0', 0.05));
    if (wall.dist < WEAPON.range) fx.add(burst(scene, end, { color: '#eee', count: 5, speed: 2.5, life: 0.25, size: 0.05 }));
    muzzle.visible = true;
    muzzle.rotation.z = Math.random() * Math.PI;
    recoil = Math.min(recoil + 0.6, 1.2);
    me.pitch = clamp(me.pitch + 0.006, -1.55, 1.55);
    sfx.play('shoot', { volume: 0.35 });
    if (me.ammo === 0) startReload();
  }

  function startReload() {
    if (!me.alive || timeNow < me.reloadingUntil || me.ammo >= WEAPON.magSize) return;
    me.reloadingUntil = timeNow + WEAPON.reloadTime;
    api.send('reload');
    sfx.play('click', { volume: 0.4 });
    setTimeout(() => {
      if (me.alive) {
        me.ammo = WEAPON.magSize;
        sfx.play('click', { volume: 0.4, pitch: 1.4 });
      }
    }, WEAPON.reloadTime * 1000);
  }

  // ---------- per-frame update ----------
  function updateLocal(dt) {
    const { dx, dy } = input.consumeMouse(); // always drain, so mouse moved while dead doesn't snap the view
    if (!me.alive) return;
    me.yaw -= dx * MOUSE_SENS;
    me.pitch = clamp(me.pitch - dy * MOUSE_SENS, -1.55, 1.55);

    const ax = input.axes();
    const sin = Math.sin(me.yaw);
    const cos = Math.cos(me.yaw);
    let wx = -sin * ax.z + cos * ax.x;
    let wz = -cos * ax.z - sin * ax.x;
    const wl = Math.hypot(wx, wz);
    const speed = MOVE.runSpeed * (mode.speedMul?.() ?? 1);
    if (wl > 0) {
      wx = (wx / wl) * speed;
      wz = (wz / wl) * speed;
    }
    const accel = me.onGround ? MOVE.groundAccel : MOVE.airAccel;
    const k = 1 - Math.exp(-accel * dt);
    me.vel[0] += (wx - me.vel[0]) * k;
    me.vel[2] += (wz - me.vel[2]) * k;
    me.vel[1] -= MOVE.gravity * dt;
    if (me.onGround && input.down('Space')) {
      me.vel[1] = MOVE.jumpVelocity;
      me.onGround = false;
      sfx.play('jump', { volume: 0.15 });
    }
    moveCharacter(me, dt, MAP.boxes, BODY);
    if (me.onGround && me.vel[1] < 0) me.vel[1] = 0;

    if (input.pressed('KeyR')) startReload();
    if (input.mouseDown(0)) tryShoot();

    sendAccum += dt;
    if (sendAccum >= 1 / NET.inputHz) {
      sendAccum = 0;
      api.send('move', {
        life: me.life,
        p: me.pos.map((n) => Math.round(n * 1000) / 1000),
        v: me.vel.map((n) => Math.round(n * 100) / 100),
        y: Math.round(me.yaw * 1000) / 1000,
        x: Math.round(me.pitch * 1000) / 1000,
      });
    }
  }

  // ---------- spectating ----------
  /** Live players (humans and bots) you can watch. */
  function watchable() {
    const list = [];
    for (const [id, r] of remotes) if (r.char.group.visible) list.push(id);
    return list.sort((a, b) => (api.player(a)?.name ?? '').localeCompare(api.player(b)?.name ?? ''));
  }

  function cycleTarget(step) {
    const list = watchable();
    if (!list.length) {
      spec.target = null;
      return;
    }
    const i = list.indexOf(spec.target);
    spec.target = list[(i + step + list.length) % list.length];
    watchedShots = []; // don't replay the previous player's shots on the new gun
    spec.mode = 'follow';
  }

  function toggleFree() {
    if (spec.mode === 'free') {
      spec.mode = 'follow';
      if (!watchable().includes(spec.target)) cycleTarget(1);
    } else {
      // Start flying from wherever the camera is now.
      spec.mode = 'free';
      spec.pos = camera.position.toArray();
      spec.yaw = camera.rotation.y;
      spec.pitch = camera.rotation.x;
    }
  }

  function updateSpectator(dt) {
    const { dx, dy } = input.consumeMouse();
    if (input.pressed('KeyF')) toggleFree();
    if (input.clicked(0) || input.pressed('KeyE')) cycleTarget(1);
    if (input.pressed('KeyQ')) cycleTarget(-1);
    if (input.pressed('KeyT') && api.teams) api.ui.openTeamPicker();
    if (spec.mode === 'follow') {
      // Keep a valid target; fall back to the free camera if nobody can be watched.
      if (!watchable().includes(spec.target)) cycleTarget(1);
      if (!spec.target) spec.mode = 'free';
    }
    if (spec.mode === 'free') {
      spec.yaw -= dx * MOUSE_SENS;
      spec.pitch = clamp(spec.pitch - dy * MOUSE_SENS, -1.55, 1.55);
      const ax = input.axes();
      const fwd = dirFromYawPitch(spec.yaw, spec.pitch);
      const right = [Math.cos(spec.yaw), 0, -Math.sin(spec.yaw)];
      const up = (input.down('Space') ? 1 : 0) - (input.down('ControlLeft') || input.down('KeyC') ? 1 : 0);
      const speed = input.down('ShiftLeft') ? 40 : 14;
      for (let i = 0; i < 3; i++) spec.pos[i] += (fwd[i] * ax.z + right[i] * ax.x + (i === 1 ? up : 0)) * speed * dt;
      // Noclip, but stay inside the map's outer box.
      const b = MAP.bounds;
      spec.pos = [clamp(spec.pos[0], b.min[0] - 5, b.max[0] + 5), clamp(spec.pos[1], 0.3, 60), clamp(spec.pos[2], b.min[2] - 5, b.max[2] + 5)];
    }
  }

  function updateCamera(dt) {
    const spectating = isSpectating();
    let gunOwner = null; // whose gun the viewmodel shows this frame
    if (me.alive && !api.spectating) {
      camera.position.set(me.pos[0], me.pos[1] + MOVE.eyeHeight, me.pos[2]);
      camera.rotation.set(me.pitch, me.yaw, 0);
      viewmodel.visible = true;
      gunOwner = 'me';
    } else if (spectating && spec.mode === 'follow' && remotes.get(spec.target)) {
      // First-person view of the watched player: their body is hidden so it doesn't block the
      // view, and the viewmodel stands in for their gun.
      const r = remotes.get(spec.target);
      const g = r.char.group;
      camera.position.set(g.position.x, g.position.y + MOVE.eyeHeight, g.position.z);
      camera.rotation.set(r.pitch ?? 0, g.rotation.y, 0);
      viewmodel.visible = true;
      gunOwner = spec.target;
      setStripeColor(r.team);
    } else if (spectating || api.spectating) {
      camera.position.set(spec.pos[0], spec.pos[1], spec.pos[2]);
      camera.rotation.set(spec.pitch, spec.yaw, 0);
      viewmodel.visible = false;
    } else if (me.deathCam) {
      // Float up and look down at where you died.
      me.deathCam.t += dt;
      const rise = Math.min(3, me.deathCam.t * 2);
      camera.position.set(me.deathCam.pos[0], me.deathCam.pos[1] + rise, me.deathCam.pos[2]);
      camera.rotation.set(lerp(camera.rotation.x, -1.0, Math.min(1, dt * 3)), camera.rotation.y, 0);
      viewmodel.visible = false;
      spec.pos = camera.position.toArray();
      spec.yaw = camera.rotation.y;
      spec.pitch = camera.rotation.x;
    }
    if (gunOwner === 'me') setStripeColor(myTeam);
    if (gunOwner && gunOwner !== 'me') {
      // Play the watched player's queued shots as they become visible.
      while (watchedShots.length && watchedShots[0] <= timeNow) {
        watchedShots.shift();
        watchedLastShot = timeNow;
        recoil = Math.min(recoil + 0.6, 1.2);
        muzzle.visible = true;
        muzzle.rotation.z = Math.random() * Math.PI;
      }
    } else {
      watchedShots = [];
    }
    recoil = Math.max(0, recoil - dt * 8);
    viewmodel.position.z = -0.45 + recoil * 0.06;
    viewmodel.rotation.x = recoil * 0.12;
    const lastFlash = gunOwner === 'me' ? me.lastShotAt : watchedLastShot;
    if (timeNow - lastFlash > 0.04) muzzle.visible = false;
    // Lower the gun while reloading (only known for your own gun).
    const reloading = gunOwner === 'me' && timeNow < me.reloadingUntil;
    viewmodel.position.y = lerp(viewmodel.position.y, reloading ? -0.42 : -0.2, Math.min(1, dt * 12));
  }

  function updateRemotes() {
    const renderAt = api.serverNow() - NET.interpDelayMs;
    const watching = isSpectating() && spec.mode === 'follow' ? spec.target : null;
    for (const [id, r] of remotes) {
      const s = r.history.at(renderAt);
      if (!s) continue;
      r.char.group.visible = s.alive;
      r.char.group.position.set(s.pos[0], s.pos[1], s.pos[2]);
      r.char.group.rotation.y = s.yaw;
      r.char.head.rotation.x = s.pitch * 0.6;
      r.char.gun.rotation.x = s.pitch;
      r.pitch = s.pitch;
      // Don't render the model we're looking out of (its head would fill the screen).
      const hide = id === watching;
      for (const child of r.char.group.children) child.visible = !hide;
    }
  }

  // Inspect the local player and what is drawn for others from the browser console: __shooterDebug()
  window.__shooterDebug = () => ({
    pos: me.pos, yaw: me.yaw, pitch: me.pitch, alive: me.alive, life: me.life, locked: input.locked,
    spectating: isSpectating(), spec: { mode: spec.mode, target: spec.target, pos: spec.pos }, camera: camera.position.toArray(),
    viewmodel: { visible: viewmodel.visible, stripe: `#${gunStripe.material.color.getHexString()}`, muzzle: muzzle.visible, recoil },
    remotes: Object.fromEntries([...remotes].map(([id, r]) => [id, { visible: r.char.group.visible, pos: r.char.group.position.toArray() }])),
    fps: Math.round(fps),
  });
  // Point the free camera somewhere (while spectating): __shooterCam([x, y, z], yaw, pitch)
  window.__shooterCam = (pos, yaw = spec.yaw, pitch = spec.pitch) => {
    spec.mode = 'free';
    spec.pos = [...pos];
    spec.yaw = yaw;
    spec.pitch = pitch;
  };

  let fps = 60;
  const stop = loop((dt, t) => {
    timeNow = t;
    if (dt > 0) fps = fps * 0.95 + (1 / dt) * 0.05;
    const spectating = isSpectating();
    if (spectating) updateSpectator(dt);
    else updateLocal(dt);
    updateRemotes();
    updateCamera(dt);
    mode.frame?.(dt, t);
    fx.update(dt);
    hud.setAmmo(me.ammo, timeNow < me.reloadingUntil);
    hud.showClickHint(!input.locked && !api.ui.isBlocking() && (me.alive || spectating) && !api.spectating);
    api.ui.showHint(!spectating); // the spectator bar shows its own keys
    hud.setSpectate(spectating ? spec.mode : null, { target: spec.target, dead: !api.spectating, canPick: Boolean(api.teams) });
    if (!me.alive && me.deathCam && !api.spectating) {
      if (me.deathCam.t >= DEATH_CAM_SECONDS) me.deathCam.t += dt;
      me.respawnIn = Math.max(0, me.respawnIn - dt);
      hud.setDead(true, me.respawnIn, me.killer, { tint: me.deathCam.t < DEATH_CAM_SECONDS });
    } else if (api.spectating) {
      hud.setDead(false);
    }
    input.endFrame();
    stage.render();
  });

  return {
    scene,
    camera,
    hud,
    fx,
    remotes,
    me,
    span,
    myTeam: () => myTeam,
    /** Where the viewer is looking from (your eyes, the watched player's, or the free camera). */
    viewPos: () => camera.position,
    destroy() {
      stop();
      mode.destroy?.();
      input.destroy();
      hud.destroy();
      stage.destroy();
      delete window.__shooterDebug;
      delete window.__shooterCam;
    },
  };
}
