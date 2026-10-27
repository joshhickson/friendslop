// Test-only bot: walks toward the middle of the map, so tests can see it move on its own.

export default {
  mount(api) {
    let target = 1;
    api.on('spawn', (s) => { target = s.pos[0] > 0 ? -1 : 1; });
    const timer = setInterval(() => api.send('input', { dx: target, dy: 0 }), 50);
    return { destroy() { clearInterval(timer); } };
  },
};
