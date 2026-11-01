// NES lockstep spike, browser side. Each player picks their own copy of the game file; it never
// leaves this computer. Every browser runs the same emulator in step: frame f only runs once every
// seated player's input for frame f has arrived, and each input is sent DELAY frames ahead so it has
// time to get there. Every CHECK_EVERY frames the browsers compare a fingerprint of the game's
// memory, so a desync is caught instead of two different games carrying on.

import { defineClientGame, h } from '/client/kit/index.js';
import NES from './vendor/jsnes/nes.js';

const FPS = 60.0988; // the NES's NTSC frame rate
const STEP = 1000 / FPS;
const CHECK_EVERY = 120;

// Bit i of an input byte is jsnes button i: A, B, Select, Start, Up, Down, Left, Right.
const KEYS = { KeyX: 0, KeyZ: 1, ShiftLeft: 2, ShiftRight: 2, Enter: 3, ArrowUp: 4, ArrowDown: 5, ArrowLeft: 6, ArrowRight: 7 };
// Standard gamepad mapping: right face button is A, bottom is B, like an NES pad turned sideways.
const PAD = { 1: 0, 0: 1, 8: 2, 9: 3, 12: 4, 13: 5, 14: 6, 15: 7 };

/** FNV-1a over byte arrays, as 8 hex digits: cheap enough to run every couple of seconds. */
function fnv(...arrays) {
  let x = 0x811c9dc5;
  for (const a of arrays) for (let i = 0; i < a.length; i++) x = Math.imul(x ^ (a[i] & 0xff), 0x01000193) >>> 0;
  return x.toString(16).padStart(8, '0');
}

async function fingerprint(bytes) {
  if (globalThis.crypto?.subtle) {
    const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  return fnv(bytes) + fnv(bytes.subarray(1)); // no SubtleCrypto here: weaker, fine for a spike
}

export default defineClientGame({
  mount(api) {
    const canvas = h('canvas', { width: 256, height: 240, style: { width: '100%', height: '100%', objectFit: 'contain', imageRendering: 'pixelated', display: 'block', background: '#000' } });
    api.root.append(canvas);
    const g = canvas.getContext('2d');
    const image = g.createImageData(256, 240);
    const pixels = new Uint32Array(image.data.buffer);

    const file = h('input', { type: 'file', accept: '.nes' });
    const status = h('p', 'Pick your own copy of the game (.nes). It stays on this computer: only a fingerprint of it is compared with the other players.');
    const stats = h('pre', { style: { margin: 0, font: '12px ui-monospace, monospace' } });
    const panel = h('div.interactive', { style: { position: 'absolute', left: '12px', top: '12px', maxWidth: '360px', padding: '10px 12px', background: '#f3f1eaee', color: '#22201c', border: '2px solid #22201c', font: '14px "Bricolage Grotesque", system-ui, sans-serif' } },
      file, status, stats);
    api.hud.append(panel);

    let rom = null;
    let seat = 0;
    let seats = [];
    let delay = 4;
    let nes = null;
    let frame = 0; // the next frame to run
    let sentFor = -1; // the last frame this player has sent input for
    const inputs = new Map(); // frame -> [, seat1, seat2]
    const held = new Set(); // jsnes button numbers held on the keyboard
    let script = null; // test hook: (frame) => input byte, instead of keyboard and gamepad
    let driftFrames = 0; // test hook: frames left in which only this browser sees an extra press
    const st = { ran: 0, stalledSteps: 0, received: 0, minLead: Infinity, checks: 0, desyncs: 0, lastCheck: '' };
    let timer = 0;
    let raf = 0;

    const say = (text) => { status.textContent = text; };

    function localInput() {
      if (script) return script(frame + delay) & 0xff;
      if (api.ui.isBlocking()) return 0;
      let b = 0;
      for (const n of held) b |= 1 << n;
      for (const pad of navigator.getGamepads?.() ?? []) {
        if (!pad) continue;
        for (const [i, n] of Object.entries(PAD)) if (pad.buttons[i]?.pressed) b |= 1 << n;
        if (pad.axes[0] < -0.5) b |= 1 << 6;
        if (pad.axes[0] > 0.5) b |= 1 << 7;
        if (pad.axes[1] < -0.5) b |= 1 << 4;
        if (pad.axes[1] > 0.5) b |= 1 << 5;
      }
      return b;
    }

    function put(f, s, b) {
      let row = inputs.get(f);
      if (!row) inputs.set(f, (row = []));
      row[s] = b;
    }

    const complete = (f) => {
      const row = inputs.get(f);
      return Boolean(row) && seats.every((s) => row[s] !== undefined);
    };

    /** Runs the next frame if everyone's input for it is here. False when it has to wait. */
    function tryFrame() {
      if (seat && sentFor < frame + delay) {
        sentFor = frame + delay;
        const b = localInput();
        put(sentFor, seat, b);
        api.send('in', { f: sentFor, b });
      }
      if (!complete(frame)) return false;
      const row = inputs.get(frame);
      inputs.delete(frame);
      for (const s of seats) for (let n = 0; n < 8; n++) {
        // drift (test hook): this browser alone sees Right held on every pad, as if inputs got lost
        const b = driftFrames > 0 ? row[s] | 0x80 : row[s];
        if (b & (1 << n)) nes.buttonDown(s, n);
        else nes.buttonUp(s, n);
      }
      nes.frame();
      if (driftFrames > 0) driftFrames--;
      frame++;
      st.ran++;
      if (frame % CHECK_EVERY === 0) {
        const c = nes.cpu;
        api.send('h', { f: frame, h: fnv(c.mem.subarray(0, 0x800), nes.ppu.spriteMem, [c.REG_ACC, c.REG_X, c.REG_Y, c.REG_SP & 0xff, c.REG_PC & 0xff, c.REG_PC >> 8]) });
      }
      return true;
    }

    let last = 0;
    let acc = 0;
    function loop() {
      timer = setTimeout(loop, 2);
      const now = performance.now();
      acc = Math.min(acc + now - last, STEP * 8);
      last = now;
      while (acc >= STEP) {
        if (!tryFrame()) {
          st.stalledSteps++;
          acc = Math.min(acc, STEP);
          break;
        }
        acc -= STEP;
      }
    }

    function draw() {
      raf = requestAnimationFrame(draw);
      stats.textContent = [
        `seat ${seat || 'watching'} | delay ${delay} frames | frame ${frame}`,
        `waited ${st.stalledSteps} steps for input | inputs received ${st.received}`,
        `smallest lead ${Number.isFinite(st.minLead) ? st.minLead : '-'} frames`,
        `memory checks ${st.checks}, desyncs ${st.desyncs}${st.lastCheck ? ` (${st.lastCheck})` : ''}`,
      ].join('\n');
    }
    draw();

    async function useBytes(bytes) {
      rom = bytes;
      say('Comparing your copy with the other players...');
      api.send('rom', { hash: await fingerprint(bytes) });
    }

    file.addEventListener('change', async () => {
      const f = file.files?.[0];
      if (f) useBytes(new Uint8Array(await f.arrayBuffer()));
    });

    const onKey = (down) => (e) => {
      const n = KEYS[e.code];
      if (n === undefined) return;
      e.preventDefault();
      if (down) held.add(n);
      else held.delete(n);
    };
    const keydown = onKey(true);
    const keyup = onKey(false);
    addEventListener('keydown', keydown);
    addEventListener('keyup', keyup);

    api.on('hello', (m) => {
      seat = m.seat;
      if (m.started) say('This game already started, so you are watching. Pick the same game file to watch it.');
    });
    api.on('mismatch', () => say("Your copies of the game aren't the same version, so the game can't run in step. Everyone needs the exact same file."));
    api.on('go', (m) => {
      if (!rom) return say('The game started without you. Pick your file to watch.');
      delay = m.delay;
      seats = Object.values(m.seats).sort();
      seat = m.seats[api.me] ?? 0;
      for (let f = 0; f < delay; f++) for (const s of seats) put(f, s, 0);
      sentFor = delay - 1;
      nes = new NES({
        emulateSound: false,
        onFrame(buffer) {
          for (let i = 0; i < 256 * 240; i++) pixels[i] = 0xff000000 | buffer[i];
          g.putImageData(image, 0, 0);
        },
      });
      nes.loadROM(rom);
      file.remove();
      say(seat ? `You are player ${seat}.` : 'You are watching.');
      last = performance.now();
      loop();
    });
    api.on('in', (m) => {
      st.received++;
      st.minLead = Math.min(st.minLead, m.f - frame);
      put(m.f, m.s, m.b);
    });
    api.on('check', (m) => {
      st.checks++;
      if (!m.same) {
        st.desyncs++;
        st.lastCheck = `frame ${m.f} differed`;
        say(`The games drifted apart at frame ${m.f}. In a real game this would stop the match.`);
      }
    });

    // Test hooks for the spike's Playwright script (this frame has its own opaque origin).
    globalThis.__nesSpike = {
      stats: () => ({ ...st, frame, seat, delay, pending: inputs.size }),
      useBytes: (arr) => useBytes(new Uint8Array(arr)),
      // Presses that look random but are the same for any given frame and seed (eval isn't allowed here).
      // They change every 16 frames and never press Select.
      setScript: (seed) => { script = (f) => parseInt(fnv([f >> 4, (f >> 12) & 0xff, seed & 0xff]), 16) & 0xfb; },
      drift: (frames = 60) => { driftFrames = frames; },
    };

    return {
      destroy() {
        clearTimeout(timer);
        cancelAnimationFrame(raf);
        removeEventListener('keydown', keydown);
        removeEventListener('keyup', keyup);
        canvas.remove();
        panel.remove();
        delete globalThis.__nesSpike;
      },
    };
  },
});
