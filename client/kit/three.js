// Low-poly three.js helpers for quick 3D games.
//   import { THREE, createStage, buildBoxWorld, makeCharacter, textSprite } from '/client/kit/three.js';

import * as THREE from 'three';

export { THREE };

const materialCache = new Map();

/** Flat-shaded material, cached per color so hundreds of boxes share a handful of materials. */
export function flatMat(color, opts = {}) {
  const key = `${color}|${JSON.stringify(opts)}`;
  if (!materialCache.has(key)) {
    materialCache.set(key, new THREE.MeshLambertMaterial({ color, flatShading: true, ...opts }));
  }
  return materialCache.get(key);
}

/**
 * Renderer + scene + camera that fill `root` and resize with it.
 * Returns { renderer, scene, camera, render(), destroy() }.
 */
export function createStage(root, { fov = 75, background = '#9fd4ff', fog = [60, 160], shadows = false } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = shadows;
  renderer.domElement.style.display = 'block';
  root.append(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(background);
  if (fog) scene.fog = new THREE.Fog(background, fog[0], fog[1]);

  const camera = new THREE.PerspectiveCamera(fov, 1, 0.05, 500);
  camera.rotation.order = 'YXZ';

  scene.add(new THREE.HemisphereLight('#ffffff', '#55606e', 1.6));
  const sun = new THREE.DirectionalLight('#fff4e0', 1.6);
  sun.position.set(30, 60, 20);
  scene.add(sun);

  const resize = () => {
    const w = root.clientWidth || window.innerWidth;
    const hgt = root.clientHeight || window.innerHeight;
    renderer.setSize(w, hgt, false);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    camera.aspect = w / hgt;
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(root);
  resize();

  return {
    renderer,
    scene,
    camera,
    sun,
    canvas: renderer.domElement,
    render() {
      renderer.render(scene, camera);
    },
    destroy() {
      ro.disconnect();
      scene.traverse((o) => {
        o.geometry?.dispose?.();
        if (o.material?.map) o.material.map.dispose();
        if (o.isSprite) o.material.dispose();
      });
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

/** Animation loop with a clamped dt. Returns stop(). */
export function loop(fn) {
  let last = performance.now();
  let raf = 0;
  let stopped = false;
  const step = (now) => {
    if (stopped) return;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    fn(dt, now / 1000);
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
  };
}

export function box(w, hgt, d, color) {
  return new THREE.Mesh(new THREE.BoxGeometry(w, hgt, d), flatMat(color));
}

/** Mesh for an AABB { min, max, color }. */
export function boxFromAABB(b, color = b.color ?? '#888') {
  const size = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
  const m = box(size[0], size[1], size[2], color);
  m.position.set((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
  return m;
}

/**
 * Builds a static level from an array of AABBs ({ min, max, color }).
 * Boxes sharing a color are merged into one instanced mesh per color for speed.
 */
export function buildBoxWorld(scene, boxes) {
  const group = new THREE.Group();
  const byColor = new Map();
  for (const b of boxes) {
    if (b.invisible) continue;
    const c = b.color ?? '#888888';
    if (!byColor.has(c)) byColor.set(c, []);
    byColor.get(c).push(b);
  }
  const unit = new THREE.BoxGeometry(1, 1, 1);
  const m4 = new THREE.Matrix4();
  for (const [color, list] of byColor) {
    const mesh = new THREE.InstancedMesh(unit, flatMat(color), list.length);
    list.forEach((b, i) => {
      m4.makeScale(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
      m4.setPosition((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
      mesh.setMatrixAt(i, m4);
    });
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
  }
  scene.add(group);
  return group;
}

/** Billboard text label (e.g. player names). */
export function textSprite(text, { color = '#ffffff', size = 0.32, bg = 'rgba(0,0,0,0.45)' } = {}) {
  const canvas = document.createElement('canvas');
  const g = canvas.getContext('2d');
  const fontPx = 48;
  g.font = `bold ${fontPx}px system-ui, sans-serif`;
  const w = Math.ceil(g.measureText(text).width) + 24;
  canvas.width = w;
  canvas.height = fontPx + 16;
  g.font = `bold ${fontPx}px system-ui, sans-serif`;
  if (bg) {
    g.fillStyle = bg;
    g.beginPath();
    g.roundRect?.(0, 0, canvas.width, canvas.height, 12);
    if (!g.roundRect) g.rect(0, 0, canvas.width, canvas.height);
    g.fill();
  }
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, canvas.width / 2, canvas.height / 2 + 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: true, transparent: true }));
  sprite.scale.set((size * canvas.width) / canvas.height, size, 1);
  return sprite;
}

/**
 * Blocky humanoid. Origin at the feet, facing -Z. Total height ~1.9.
 * Returns { group, head, body, gun, setColor(color) }.
 */
export function makeCharacter(color, { skin = '#f1c27d' } = {}) {
  const group = new THREE.Group();
  const legs = box(0.6, 0.75, 0.35, '#333a44');
  legs.position.y = 0.375;
  const body = box(0.8, 0.7, 0.45, color);
  body.position.y = 1.1;
  const head = box(0.45, 0.45, 0.45, skin);
  head.position.y = 1.65;
  const visor = box(0.36, 0.12, 0.05, '#222222');
  visor.position.set(0, 1.7, -0.23);
  const gun = box(0.12, 0.14, 0.7, '#2b2b2b');
  gun.position.set(0.32, 1.2, -0.4);
  group.add(legs, body, head, visor, gun);
  return {
    group,
    head,
    body,
    gun,
    setColor(c) {
      body.material = flatMat(c);
    },
  };
}

/** Simple low-poly flag on a pole. Origin at the pole's base. */
export function makeFlag(color) {
  const group = new THREE.Group();
  const pole = box(0.08, 2.2, 0.08, '#dddddd');
  pole.position.y = 1.1;
  const cloth = box(0.9, 0.55, 0.05, color);
  cloth.position.set(0.47, 1.85, 0);
  group.add(pole, cloth);
  return group;
}

/** Fading line from a to b (bullet tracer). Call update(dt) each frame; returns false when finished. */
export function tracer(scene, from, to, color = '#ffee88', life = 0.08) {
  const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...from), new THREE.Vector3(...to)]);
  const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1 });
  const line = new THREE.Line(geo, mat);
  scene.add(line);
  let t = 0;
  return {
    update(dt) {
      t += dt;
      mat.opacity = Math.max(0, 1 - t / life);
      if (t >= life) {
        scene.remove(line);
        geo.dispose();
        mat.dispose();
        return false;
      }
      return true;
    },
  };
}

/** Burst of small cubes (impacts, deaths). Call update(dt) each frame; returns false when finished. */
export function burst(scene, at, { color = '#ffcc55', count = 8, speed = 4, life = 0.4, size = 0.08 } = {}) {
  const parts = [];
  const geo = new THREE.BoxGeometry(size, size, size);
  const mat = new THREE.MeshBasicMaterial({ color });
  for (let i = 0; i < count; i++) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(...at);
    const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.5 + Math.random() * 0.5));
    parts.push({ m, v });
    scene.add(m);
  }
  let t = 0;
  return {
    update(dt) {
      t += dt;
      for (const p of parts) {
        p.v.y -= 15 * dt;
        p.m.position.addScaledVector(p.v, dt);
      }
      if (t >= life) {
        for (const p of parts) scene.remove(p.m);
        geo.dispose();
        mat.dispose();
        return false;
      }
      return true;
    },
  };
}

/** Holds short-lived effects (tracer(), burst(), ...) and updates them each frame. */
export class Effects {
  constructor() {
    this.items = [];
  }

  add(fx) {
    this.items.push(fx);
    return fx;
  }

  update(dt) {
    this.items = this.items.filter((fx) => fx.update(dt));
  }
}
