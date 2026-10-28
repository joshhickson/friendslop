// Starter, browser side. Draws the server's state on a 2D canvas and sends WASD input.

import { defineClientGame, Input, h } from '/client/kit/index.js';

// friendslop's Blockout look: a light board with ink edges on a grey grid. Change any of it.
const BG = '#c9c7be';
const BOARD = '#f3f1ea';
const GRID = '#e2dfd5';
const INK = '#22201c';
const ACCENT = '#f28c28';
const COLORS = ['#d93a2b', '#2e5bd8', '#2f8f4e', '#e8b923', '#7b4bc4', '#f28c28', '#1f9aa0', '#d6458f'];

export default defineClientGame({
  mount(api) {
    const canvas = h('canvas', { style: { width: '100%', height: '100%', display: 'block' } });
    api.root.append(canvas);
    const g = canvas.getContext('2d');
    const input = new Input(api, canvas, { pointerLock: false });
    let state = null;
    let lastSent = '';
    let raf = 0;

    api.on('state', (s) => { state = s; });

    const colorFor = (id) => COLORS[api.players().findIndex((p) => p.id === id) % COLORS.length] ?? INK;

    function frame() {
      raf = requestAnimationFrame(frame);
      const { x, z } = input.axes();
      const msg = `${x},${-z}`;
      if (msg !== lastSent) {
        lastSent = msg;
        api.send('input', { dx: x, dy: -z });
      }
      input.endFrame();

      const w = (canvas.width = canvas.clientWidth * devicePixelRatio);
      const hh = (canvas.height = canvas.clientHeight * devicePixelRatio);
      g.fillStyle = BG;
      g.fillRect(0, 0, w, hh);
      if (!state) return;
      const scale = Math.min(w, hh) / state.size * 0.9;
      g.save();
      g.translate((w - state.size * scale) / 2, (hh - state.size * scale) / 2);
      g.scale(scale, scale);
      g.fillStyle = INK;
      g.fillRect(0.3, 0.3, state.size, state.size); // the hard offset shadow
      g.fillStyle = BOARD;
      g.fillRect(0, 0, state.size, state.size);
      g.strokeStyle = GRID;
      g.lineWidth = 0.05;
      for (let i = 1; i < state.size; i++) {
        g.beginPath();
        g.moveTo(i, 0); g.lineTo(i, state.size);
        g.moveTo(0, i); g.lineTo(state.size, i);
        g.stroke();
      }
      g.strokeStyle = INK;
      g.lineWidth = 0.15;
      g.strokeRect(0, 0, state.size, state.size);
      g.font = '800 1px "Bricolage Grotesque", system-ui, sans-serif';
      g.textAlign = 'center';
      for (const p of state.players) {
        g.fillStyle = colorFor(p.id);
        g.beginPath();
        g.arc(p.x, p.y, 0.6, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = p.id === api.me ? ACCENT : INK;
        g.lineWidth = p.id === api.me ? 0.25 : 0.12;
        g.stroke();
        g.fillStyle = INK;
        g.fillText(api.player(p.id)?.name ?? '', p.x, p.y - 1);
      }
      g.restore();
    }
    frame();

    return {
      destroy() {
        cancelAnimationFrame(raf);
        input.destroy();
        canvas.remove();
      },
    };
  },
});
