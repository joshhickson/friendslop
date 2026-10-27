// Starter, browser side. Draws the server's state on a 2D canvas and sends WASD input.

import { defineClientGame, Input, h } from '/client/kit/index.js';

const COLORS = ['#ff5a5f', '#4aa3ff', '#4cd97b', '#ffcc33', '#c77dff', '#ff9f43', '#2ee6d6', '#ff6bcb'];

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

    const colorFor = (id) => COLORS[api.players().findIndex((p) => p.id === id) % COLORS.length] ?? '#fff';

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
      g.fillStyle = '#1b1f27';
      g.fillRect(0, 0, w, hh);
      if (!state) return;
      const scale = Math.min(w, hh) / state.size * 0.9;
      g.save();
      g.translate((w - state.size * scale) / 2, (hh - state.size * scale) / 2);
      g.scale(scale, scale);
      g.fillStyle = '#262b36';
      g.fillRect(0, 0, state.size, state.size);
      g.font = '1px system-ui';
      g.textAlign = 'center';
      for (const p of state.players) {
        g.fillStyle = colorFor(p.id);
        g.beginPath();
        g.arc(p.x, p.y, 0.6, 0, Math.PI * 2);
        g.fill();
        if (p.id === api.me) {
          g.strokeStyle = '#fff';
          g.lineWidth = 0.15;
          g.stroke();
        }
        g.fillStyle = '#fff';
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
