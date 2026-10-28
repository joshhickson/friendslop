// Control Points — browser side. The shooter itself (movement, shooting, other players,
// spectating, HUD) comes from games/_shooter/client; this file adds the capture points:
// a ring + banner pole at each point in the world, the A–E bar at the top of the screen, and a
// capture progress bar while you stand on a point.

import { defineClientGame, sfx, h, replace } from '/client/kit/index.js';
import { THREE, flatMat, textSprite } from '/client/kit/three.js';
import { mountShooter } from '../../_shooter/client/shooter.js';
import { CP_MAP as MAP } from '../shared/map.js';
import { CAPTURE } from '../shared/constants.js';

const NEUTRAL = '#a8a49a';
const INK = '#22201c';

// friendslop's Blockout look, to match the shooter HUD (games/_shooter/client/hud.js).
const CSS = `
.cp-bar { display:flex; gap:6px; align-items:center; }
.cp-pt { position:relative; width:46px; height:46px; border-radius:50%; display:flex; align-items:center; justify-content:center;
  font:400 18px Bungee,system-ui,sans-serif; border:3px solid ${INK}; background:var(--o); color:#fff; text-shadow:1px 1px 0 ${INK};
  box-shadow:2px 2px 0 ${INK}; overflow:hidden; }
.cp-pt.base { width:30px; height:30px; font-size:11px; border-radius:8px; }
.cp-pt .fill { position:absolute; left:0; bottom:0; width:100%; background:var(--c); opacity:.9; }
.cp-pt span { position:relative; }
.cp-pt.locked { filter:saturate(.45); }
.cp-pt.target { box-shadow:0 0 0 3px #f28c28, 3px 3px 0 3px ${INK}; }
.cp-pt.contested { animation:cpblink .5s steps(2) infinite; }
.cp-pt .lock { position:absolute; right:1px; top:-1px; font-size:11px; }
@keyframes cpblink { 50% { border-color:#f28c28; } }
.cp-cap { position:absolute; left:50%; top:60%; transform:translateX(-50%); width:300px; text-align:center; font-weight:800; font-size:15px; display:none;
  background:#f3f1ea; color:${INK}; border:3px solid ${INK}; border-radius:10px; box-shadow:3px 3px 0 ${INK}; padding:6px 10px 8px; text-shadow:none; }
.cp-cap .track { height:12px; margin-top:5px; border-radius:6px; background:#e6e3d9; border:2px solid ${INK}; overflow:hidden; }
.cp-cap .bar { height:100%; width:0; }
`;

export default defineClientGame({
  mount(api) {
    let state = null; // latest snapshot `points`
    const markers = [];

    const game = mountShooter(api, {
      map: MAP,
      fog: [80, 230],
      onSnapshot(snap) {
        if (!snap.points) return;
        state = snap.points;
        renderBar();
      },
      frame: (dt, t) => updateMarkers(t),
    });
    const { scene, hud, span } = game;

    // ---------- world markers ----------
    for (const p of MAP.points) {
      const g = new THREE.Group();
      g.position.set(p.pos[0], p.pos[1], p.pos[2]);
      const ringMat = new THREE.MeshBasicMaterial({ color: NEUTRAL, transparent: true, opacity: 0.5, side: THREE.DoubleSide });
      const radius = p.base ? 3 : CAPTURE.radius;
      const ring = new THREE.Mesh(new THREE.RingGeometry(radius - 0.35, radius, 40), ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.04;
      const pole = new THREE.Mesh(new THREE.BoxGeometry(0.15, 5, 0.15), flatMat('#dddddd'));
      pole.position.y = 2.5;
      const clothMat = new THREE.MeshLambertMaterial({ color: NEUTRAL, flatShading: true });
      const cloth = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1, 0.06), clothMat);
      cloth.position.set(0.85, 4.4, 0);
      // Capture progress shown as a second, rising strip of cloth in the capturing team's color.
      const progMat = new THREE.MeshLambertMaterial({ color: NEUTRAL, flatShading: true });
      const prog = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1, 0.08), progMat);
      prog.position.set(0.85, 4.4, 0);
      prog.visible = false;
      const label = textSprite(p.base ? (p.base === 'red' ? 'RED BASE' : 'BLUE BASE') : p.label, { size: 0.9, bg: 'rgba(0,0,0,0.35)' });
      label.position.y = 6.1;
      g.add(ring, pole, cloth, prog, label);
      scene.add(g);
      markers.push({ g, ringMat, clothMat, progMat, prog, label });
    }

    const color = (team) => (team ? api.teamColor(team) : NEUTRAL);

    function updateMarkers(t) {
      if (!state) return;
      for (let i = 0; i < markers.length; i++) {
        const m = markers[i];
        const p = state[i];
        const owner = color(p.o);
        m.ringMat.color.set(p.x ? (Math.floor(t * 4) % 2 ? '#ffffff' : owner) : owner);
        m.clothMat.color.set(owner);
        m.prog.visible = p.p > 0.001 && Boolean(p.c);
        if (m.prog.visible) {
          m.progMat.color.set(p.o ? NEUTRAL : color(p.c)); // neutralizing shows grey, capturing shows the team
          m.prog.scale.y = p.p;
          m.prog.position.y = 4.4 - 0.5 + p.p / 2;
        }
        m.g.children[2].rotation.y = Math.sin(t * 1.5 + i) * 0.15; // cloth sway
      }
    }

    // ---------- HUD: point bar + capture progress ----------
    const style = h('style', CSS);
    const bar = h('div.cp-bar');
    const cap = h('div.cp-cap', h('div.label'), h('div.track', h('div.bar')));
    hud.objective.append(style, bar);
    hud.objective.parentElement.append(cap);

    function myIndex() {
      const team = game.myTeam();
      return team === 'red' ? 0 : 1;
    }

    function renderBar() {
      const t = myIndex();
      replace(bar, state.map((p, i) => {
        const meta = MAP.points[i];
        const canCap = p.ok[t];
        const fill = p.c ? Math.round(p.p * 100) : 0;
        return h(`div.cp-pt${meta.base ? '.base' : ''}${!meta.base && !canCap && p.o !== game.myTeam() ? '.locked' : ''}${canCap ? '.target' : ''}${p.x ? '.contested' : ''}`,
          { style: { '--o': color(p.o), '--c': p.o ? NEUTRAL : color(p.c) }, title: meta.label },
          p.c ? h('div.fill', { style: { height: `${fill}%` } }) : null,
          h('span', meta.base ? (meta.base === 'red' ? 'R' : 'B') : meta.label),
          !meta.base && !canCap && p.o !== game.myTeam() && p.o ? h('span.lock', '🔒') : null);
      }));
      renderCapture();
    }

    // "Capturing B" / "Contested!" / "Locked: take C first" while standing on a point.
    function renderCapture() {
      const me = game.me;
      const team = game.myTeam();
      const t = myIndex();
      let shown = false;
      if (me.alive && !api.spectating) {
        for (let i = 0; i < MAP.points.length; i++) {
          const meta = MAP.points[i];
          const p = state[i];
          if (meta.base) continue;
          const dx = me.pos[0] - meta.pos[0];
          const dz = me.pos[2] - meta.pos[2];
          if (dx * dx + dz * dz > CAPTURE.radius * CAPTURE.radius || Math.abs(me.pos[1] - meta.pos[1]) > CAPTURE.height) continue;
          shown = true;
          const label = cap.querySelector('.label');
          const fill = cap.querySelector('.bar');
          let text;
          let c = color(team);
          if (p.o === team) {
            text = p.x ? `Defending ${meta.label}!` : p.c && p.p > 0 ? `${meta.label}: enemy progress fading` : `${meta.label} is yours`;
            c = p.c && p.c !== team ? color(p.c) : c;
          } else if (!p.ok[t]) {
            const need = MAP.points[i + (team === 'red' ? -1 : 1)]?.label;
            text = `${meta.label} is locked: capture ${need} first`;
            c = '#8a867c';
          } else if (p.x) {
            text = `${meta.label} contested!`;
          } else {
            const n = p.n[t];
            text = `${p.o ? 'Neutralizing' : 'Capturing'} ${meta.label}${n > 1 ? ` ×${n}` : ''}`;
          }
          label.textContent = text;
          fill.style.background = c;
          fill.style.width = `${Math.round((p.c ? p.p : 0) * 100)}%`;
          break;
        }
      }
      cap.style.display = shown ? 'block' : 'none';
    }

    // ---------- events ----------
    api.on('point', ({ event, id, team, prev, by, bonus }) => {
      const meta = MAP.points.find((p) => p.id === id);
      const mine = game.myTeam();
      const names = (by ?? []).slice(0, 3).map((pid) => hud.nameOf(pid)).join(', ') + ((by?.length ?? 0) > 3 ? '…' : '');
      if (event === 'captured') {
        hud.feed([span(hud.teamName(team), color(team)), ` captured ${meta.label}`, names ? ` (${names})` : '']);
        hud.announce(team === mine ? `We took ${meta.label}!` : `${meta.label} was lost!`, color(team), 2200);
        sfx.play(team === mine ? 'score' : 'alarm', { volume: 0.5 });
        if (bonus) hud.timeBonus(bonus);
      } else if (event === 'neutralized') {
        hud.feed([span(hud.teamName(team), color(team)), ` neutralized ${meta.label}`]);
        if (prev === mine) hud.announce(`${meta.label} is being taken!`, color(team), 1800);
      }
    });

    // Standing in the enemy's spawn room hurts: warn while it's happening, clear soon after.
    let zoneWarnUntil = 0;
    api.on('hurt', ({ zone }) => {
      if (!zone) return;
      zoneWarnUntil = performance.now() + 700;
      hud.banner('Enemy spawn room: get out!', '#d93a2b');
    });
    const bannerTimer = setInterval(() => {
      if (zoneWarnUntil && performance.now() > zoneWarnUntil) {
        zoneWarnUntil = 0;
        hud.banner(null);
      }
    }, 250);

    return {
      destroy() {
        clearInterval(bannerTimer);
        game.destroy();
      },
    };
  },
});
