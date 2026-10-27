// Starter bot: wanders in a new random direction every second or so.
// Delete this file if your game shouldn't have bots; the lobby's Bots panel goes with it.

export default {
  mount(api) {
    const turn = () => {
      const a = Math.random() * Math.PI * 2;
      api.send('input', { dx: Math.cos(a), dy: Math.sin(a) });
    };
    turn();
    const timer = setInterval(turn, 700 + Math.random() * 800);
    return { destroy() { clearInterval(timer); } };
  },
};
