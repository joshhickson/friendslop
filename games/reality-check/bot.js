// Reality Check bot. Each bot gets a random conscience, so some drift toward Heaven and some toward Hell.
//   easy:   picks rings and choices at random
//   normal: weighs points against its conscience, with some noise
//   hard:   plays for points, and stays away from a breakdown

import { RINGS } from './shared/content.js';
import { scoreOf, expectedFx, affordable } from './shared/rules.js';

const RING_IDS = RINGS.map((r) => r.id);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export default {
  mount(api) {
    const difficulty = api.options?.difficulty ?? 'normal';
    const conscience = Math.random();   // 0 = shameless, 1 = saintly
    let acted = '';
    let timer = 0;

    function later(ms, fn) {
      clearTimeout(timer);
      timer = setTimeout(fn, ms + Math.random() * 800);
    }

    function chooseRing(me) {
      if (difficulty === 'easy') return pick(RING_IDS);
      if (me.mental <= 3) return pick(['health', 'personal']);
      if (me.money < 1500) return 'career';
      if (difficulty === 'hard' && me.sin > me.virtue + 2) return pick(['personal', 'social']);
      const weights = { career: 1.4 - conscience, health: 0.6, social: 0.8, personal: 0.4 + conscience };
      let r = Math.random() * Object.values(weights).reduce((a, b) => a + b, 0);
      for (const [ring, w] of Object.entries(weights)) if ((r -= w) <= 0) return ring;
      return 'social';
    }

    function value(me, choice) {
      const fx = expectedFx(choice);
      const after = {
        money: me.money + (fx.money ?? 0),
        mental: Math.max(0, Math.min(10, me.mental + (fx.mental ?? 0))),
        sin: Math.max(0, me.sin + (fx.sin ?? 0)),
        virtue: Math.max(0, me.virtue + (fx.virtue ?? 0)),
        minMental: me.mental,
      };
      after.minMental = Math.min(me.mental, after.mental);
      let v = scoreOf(after).total - scoreOf({ ...me, minMental: me.mental }).total;
      if (after.mental <= 1) v -= 4;   // a breakdown costs money and a turn
      if (difficulty === 'normal') v += (conscience - 0.5) * ((fx.virtue ?? 0) - (fx.sin ?? 0)) + (Math.random() - 0.5) * 2;
      return v;
    }

    function chooseCard(me, card) {
      const options = card.choices.map((c, i) => ({ c, i })).filter(({ c }) => c.ok && affordable(c, me));
      if (options.length === 0) return 0;
      if (difficulty === 'easy') return pick(options).i;
      return options.reduce((best, o) => (value(me, o.c) > value(me, best.c) ? o : best)).i;
    }

    api.on('state', (st) => {
      if (st.cur !== api.me) return;
      const key = `${st.turn}:${st.phase}`;
      if (key === acted) return;
      const me = st.players.find((p) => p.id === api.me);
      if (!me) return;
      if (st.phase === 'pick') {
        acted = key;
        later(900, () => api.send('ring', { ring: chooseRing(me) }));
      } else if (st.phase === 'card' && st.card) {
        acted = key;
        later(2200, () => api.send('choice', { i: chooseCard(me, st.card) }));
      }
    });

    return { destroy() { clearTimeout(timer); } };
  },
};
