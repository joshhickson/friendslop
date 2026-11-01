// NES lockstep spike. Every player's browser runs the same NES emulator (jsnes) on their own copy of
// the game, and only controller input travels. This file is the room's hub: it checks that everyone
// picked the same game file (by fingerprint, never the file), hands out controller seats, passes
// each frame's input on to everyone else, and compares memory fingerprints to catch a desync.
// Spike only: see docs/research/2026-10-31-browser-emulators.md.

import { defineGame, isNum } from '../../server/kit/index.js';

const SEATS = 2;       // NES controllers
const DELAY = 4;       // frames of input delay: an input for frame f is sent while frame f - DELAY runs
const FRAME_MAX = 60 * 60 * 60 * 4; // four hours of frames

const isFrame = (f) => Number.isInteger(f) && f >= 0 && f <= FRAME_MAX;
const isHex = (s) => typeof s === 'string' && /^[0-9a-f]{8,64}$/.test(s);

export default defineGame({
  id: 'nes-lockstep',
  name: 'NES lockstep spike',
  description: 'Two players, one NES game, each from their own copy of the file. Only controller input travels.',
  minPlayers: 1,
  maxPlayers: 8,
  tickRate: 1,
  controls: [['Arrows', 'd-pad'], ['X / Z', 'A / B'], ['Enter', 'Start'], ['Shift', 'Select']],

  create(ctx) {
    const players = new Map(); // id -> { seat, rom }
    const checks = new Map(); // frame -> Map(id -> memory fingerprint)
    let started = false;
    let desyncs = 0;
    let matches = 0;

    const seatsTaken = () => new Set([...players.values()].map((p) => p.seat).filter(Boolean));

    function tryStart() {
      if (started) return;
      const seated = [...players.entries()].filter(([, p]) => p.seat);
      if (seated.length < SEATS) return; // the spike waits for both controllers
      const roms = new Set([...players.values()].map((p) => p.rom));
      if (roms.has(null)) return; // somebody hasn't picked their file yet
      if (roms.size > 1) {
        ctx.broadcast('mismatch', {});
        return;
      }
      started = true;
      ctx.broadcast('go', { delay: DELAY, seats: Object.fromEntries(seated.map(([id, p]) => [id, p.seat])) });
    }

    return {
      onPlayerJoin(p) {
        const taken = seatsTaken();
        let seat = 0;
        for (let s = 1; s <= SEATS && !seat; s++) if (!taken.has(s)) seat = s;
        players.set(p.id, { seat: started ? 0 : seat, rom: null });
        ctx.send(p.id, 'hello', { seat: started ? 0 : seat, started });
      },
      onPlayerLeave(p) {
        const was = players.get(p.id);
        players.delete(p.id);
        if (started && was?.seat) ctx.endMatch({ text: `${p.name} left, so the game can't go on in step.` });
      },
      onMessage(p, type, data) {
        const me = players.get(p.id);
        if (!me || !data || typeof data !== 'object') return;
        if (type === 'rom' && isHex(data.hash) && !started) {
          me.rom = data.hash;
          tryStart();
        } else if (type === 'in' && started && me.seat && isFrame(data.f) && Number.isInteger(data.b) && data.b >= 0 && data.b < 256) {
          // Everyone else gets it, watchers included; the sender already has its own.
          ctx.broadcast('in', { s: me.seat, f: data.f, b: data.b }, { except: p.id });
        } else if (type === 'h' && started && isFrame(data.f) && isHex(data.h)) {
          let at = checks.get(data.f);
          if (!at) checks.set(data.f, (at = new Map()));
          at.set(p.id, data.h);
          const seated = [...players.entries()].filter(([, q]) => q.seat).map(([id]) => id);
          if (seated.every((id) => at.has(id))) {
            const same = new Set(seated.map((id) => at.get(id))).size === 1;
            if (same) matches++;
            else desyncs++;
            checks.delete(data.f);
            ctx.broadcast('check', { f: data.f, same, matches, desyncs });
          }
          // Old checks a player never answered (they left) shouldn't pile up.
          for (const f of checks.keys()) if (f < data.f - 600) checks.delete(f);
        } else if (type === 'rtt' && isNum(data.ms)) {
          ctx.setStat(p.id, 'rtt', Math.round(data.ms));
        }
      },
      tick() {},
    };
  },
});
