// Reality Check rules that both sides need: applying effects, traits, scoring and Judgment Day.
// Pure functions over plain player records, so the server, the bots and the client agree.

export const MENTAL_MAX = 10;
export const BREAKDOWN_BILL = 2000;   // hospital bill when mental hits 0
export const BREAKDOWN_RESET = 3;     // mental after the hospital
export const MONEY_CAP = 20000;       // money counts toward the score up to this
export const FORTITUDE_FLOOR = 6;     // keep mental at or above this all game for the bonus
export const HUSTLER_MONEY = 20000;   // end with at least this much for the bonus

/** Adjust a raw fx for a player's trait. `source` is a ring id or 'babel'; `card` is true for a card. Returns a new fx. */
export function traitFx(fx, trait, source, card = false) {
  const out = { money: fx.money ?? 0, mental: fx.mental ?? 0, sin: fx.sin ?? 0, virtue: fx.virtue ?? 0 };
  switch (trait) {
    case 'career_junkie':
      if (source === 'career') {
        if (out.money > 0) out.money = Math.round(out.money * 1.5);
        out.mental -= 1;
      }
      break;
    case 'fragile':
      if (source === 'health') out.mental *= 2;
      break;
    case 'butterfly':
      if (source === 'social' && out.mental !== 0) out.mental += Math.sign(out.mental);
      break;
    case 'zen':
      if (out.money > 0) out.money = Math.round(out.money * 0.75);
      if (source === 'personal' && card) out.virtue += 1;
      break;
    case 'crisis_magnet':
      if (source === 'babel') for (const k of Object.keys(out)) out[k] *= 2;
      break;
  }
  return out;
}

/** Apply an fx (already trait-adjusted) to a player record, with the stat limits. Returns what changed. */
export function applyFx(p, fx) {
  const before = { money: p.money, mental: p.mental, sin: p.sin, virtue: p.virtue };
  p.money += fx.money ?? 0;
  p.mental = Math.max(0, Math.min(MENTAL_MAX, p.mental + (fx.mental ?? 0)));
  p.sin = Math.max(0, p.sin + (fx.sin ?? 0));
  p.virtue = Math.max(0, p.virtue + (fx.virtue ?? 0));
  return {
    money: p.money - before.money,
    mental: p.mental - before.mental,
    sin: p.sin - before.sin,
    virtue: p.virtue - before.virtue,
  };
}

/** Score breakdown for Judgment Day. `p` needs money, mental, sin, virtue, minMental. */
export function scoreOf(p) {
  const money = Math.min(p.money, MONEY_CAP) / 1000;
  const mental = p.mental / 2;
  const saint = p.sin < 3 && p.virtue > 8 ? 5 : 0;
  const fortitude = (p.minMental ?? p.mental) >= FORTITUDE_FLOOR ? 3 : 0;
  const hustler = p.money >= HUSTLER_MONEY ? 5 : 0;
  const total = money + mental + p.virtue - p.sin + saint + fortitude + hustler;
  return { money, mental, virtue: p.virtue, sin: -p.sin, saint, fortitude, hustler, total: Math.round(total * 10) / 10 };
}

/** Heaven, Purgatory or Hell, from the moral balance. */
export function judgmentOf(p) {
  const balance = p.virtue - p.sin;
  if (balance >= 5) return 'heaven';
  if (balance <= -5) return 'hell';
  return 'purgatory';
}

export const JUDGMENT = {
  heaven: { name: 'Heaven', text: 'Pearly gates, good wifi.' },
  purgatory: { name: 'Purgatory', text: 'An eternal DMV line. Take a number.' },
  hell: { name: 'Hell', text: 'Reply-all email chains, forever.' },
};

/** Which choices a player can afford. */
export function affordable(choice, p) {
  return !choice.cost || p.money >= choice.cost;
}

/** The fx a choice will give, as far as anyone can know before a roll: the average of its roll outcomes. */
export function expectedFx(choice) {
  if (!choice.roll) {
    const fx = { ...choice.fx };
    if (choice.later) for (const [k, v] of Object.entries(choice.later.fx)) fx[k] = (fx[k] ?? 0) + v;
    return fx;
  }
  const fx = { money: 0, mental: 0, sin: 0, virtue: 0 };
  let prev = 0;
  for (const o of choice.roll) {
    const weight = (o.upTo - prev) / 6;
    prev = o.upTo;
    for (const [k, v] of Object.entries(o.fx)) fx[k] += v * weight;
  }
  return fx;
}

/** Short text for an fx, such as "+$2,000 · +2 Sin". Zero values are left out. */
export function fxText(fx) {
  const parts = [];
  if (fx.money) parts.push(`${fx.money > 0 ? '+' : '-'}$${Math.abs(Math.round(fx.money)).toLocaleString('en-US')}`);
  if (fx.mental) parts.push(`${fx.mental > 0 ? '+' : ''}${fx.mental} Mind`);
  if (fx.sin) parts.push(`${fx.sin > 0 ? '+' : ''}${fx.sin} Sin`);
  if (fx.virtue) parts.push(`${fx.virtue > 0 ? '+' : ''}${fx.virtue} Virtue`);
  return parts.join(' · ');
}

export function money(n) {
  return `${n < 0 ? '-' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
}
