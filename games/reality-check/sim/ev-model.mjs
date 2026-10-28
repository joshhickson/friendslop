// Reality Check (casino): analytic expected-value model for RULES.md section 13.
// One player, one shift, no space. Every probability here is a guess until Phase 2 measures it spatially;
// then replace the guesses with measured values and rerun. Run: node games/reality-check/sim/ev-model.mjs
const D = {
  wage: 1.5,            // $/s on post
  shiftSec: 240,
  tipsShift: 120,       // honest tips per shift (on post most of it)
  offPostHonest: 20,    // seconds an honest worker spends off post (deposit trips)
  skimRate: 50,         // $/s while holding skim
  skimMaxSec: 5,
  noiseSd: 100,         // honest count noise per station
  pWitness: { opp: 0.06, reck: 0.25 },
  pPhotoGivenWitness: 0.4,
  pGuard: { opp: 0.02, reck: 0.06 },
  guardHeatStack: 0.5,  // reckless: guard chance grows per extra cheat in the shift
  camCover: { table: 0.5, floorPick: 0.5, barPick: 0.15 }, // careful pickpockets work the bar, reckless ones the floor
  pReview: 0.2,         // share of recorded cheats flagged at the count
  conv: { photo: 0.85, guard: 0.85, word: 0.3, footage: 0.4 },
  shortageConv: (s) => Math.max(0, Math.min(0.95, (s - 200) / 500)),
  fine: 250,
  meetingShare: 0.75,
  reportConv: 0.07,   // each extra pickpocket report in a shift makes a pattern
  probationShare: 0,  // next shift wages lost
  pickAvg: 150, pickSec: 1.5, pickWalkSec: 20, offPostConv: 0.03,
};
const honestShift = D.wage * (D.shiftSec - D.offPostHonest) + D.tipsShift;
const probation = D.probationShare * D.wage * (D.shiftSec - D.offPostHonest);

function shortageP(total) { // expected conviction weight from the shortage, averaging over noise
  let acc = 0, n = 0;
  for (let z = -3; z <= 3; z += 0.05) { const w = Math.exp(-z * z / 2); acc += w * D.shortageConv(total + z * D.noiseSd); n += w; }
  return acc / n;
}

// One shift: k cheats of one kind. Returns expected take-home vs honest.
function shift(kind, k, style, amt) {
  let notCaught = 1, stolen = 0, timeLost = 0;
  const depositTrips = style === 'reck' ? 0 : Math.ceil(k / 2) * 15; // extra off-post seconds to bank chips
  const pConvOffPost = D.offPostConv * depositTrips / 15;
  for (let i = 1; i <= k; i++) {
    const stack = style === 'reck' ? 1 + D.guardHeatStack * (i - 1) : 1;
    const pw = Math.min(0.9, D.pWitness[style] * stack);
    const pg = Math.min(0.9, D.pGuard[style] * stack);
    let cam, a;
    if (kind === 'skim') { cam = D.camCover.table; a = amt; }
    else { cam = style === 'opp' ? D.camCover.barPick : D.camCover.floorPick; a = D.pickAvg; timeLost += D.pickSec + D.pickWalkSec; }
    stolen += a;
    // per-cheat chance it produces convicting evidence
    const pConvThis = 1 - (1 - pw * D.pPhotoGivenWitness * D.conv.photo)
      * (1 - pw * (1 - D.pPhotoGivenWitness) * D.conv.word)
      * (1 - pg * D.conv.guard)
      * (1 - cam * D.pReview * D.conv.footage);
    notCaught *= 1 - pConvThis;
  }
  let pConv = 1 - notCaught;
  pConv = 1 - (1 - pConv) * (1 - pConvOffPost);
  pConv *= D.meetingShare; // one conviction per meeting: other suspects compete for it
  if (kind === 'skim') pConv = 1 - (1 - pConv) * (1 - shortageP(stolen));
  else pConv = 1 - (1 - pConv) * (1 - D.offPostConv * k) * Math.pow(1 - D.reportConv, Math.max(0, k - 1));
  timeLost += depositTrips;
  const wagesLost = D.wage * timeLost;
  const carried = style === 'reck' ? 1 : 0.5; // careful cheaters bank half their chips in the locker
  const penalty = stolen + carried * D.tipsShift + D.fine + probation; // restitution of all stolen this shift, carried tips, fine
  const ev = honestShift - wagesLost + stolen - pConv * penalty;
  return { k, stolen, pConv, ev, ratio: ev / honestShift };
}
console.log('honest shift $' + honestShift.toFixed(0), ' penalty base $' + (D.tipsShift + D.fine + probation).toFixed(0));
for (const [kind, style, amt] of [['skim', 'opp', 100], ['skim', 'opp', 150], ['skim', 'opp', 250], ['skim', 'reck', 150], ['skim', 'reck', 250], ['pick', 'opp'], ['pick', 'reck']]) {
  console.log(`\n${kind} ${style} ${amt ?? ''}`);
  let prev = honestShift;
  for (let k = 1; k <= 6; k++) {
    const r = shift(kind, k, style, amt);
    console.log(`k=${k} stolen $${r.stolen} P(conv)=${(r.pConv * 100).toFixed(0)}% EV $${r.ev.toFixed(0)} (${r.ratio.toFixed(2)}x honest) marginal ${(r.ev - prev).toFixed(0)}`);
    prev = r.ev;
  }
}

// Mixed: s skims of $150 and p pickpockets, careful. Evidence from both kinds combines.
function mixed(s, p, amt = 150) {
  const a = s ? shift('skim', s, 'opp', amt) : null;
  const b = p ? shift('pick', p, 'opp') : null;
  const pa = a ? a.pConv : 0, pb = b ? b.pConv : 0;
  const pConv = 1 - (1 - pa) * (1 - pb);
  const stolen = (a ? a.stolen : 0) + (b ? b.stolen : 0);
  const wagesLost = D.wage * (p * (D.pickSec + D.pickWalkSec) + Math.ceil((s + p) / 2) * 15);
  const ev = honestShift - wagesLost + stolen - pConv * (stolen + 0.5 * D.tipsShift + D.fine);
  return { stolen, pConv, ev, ratio: ev / honestShift };
}
console.log('\nmixed careful (skims x $150, pickpockets)');
for (const [s, p] of [[1, 1], [2, 1], [1, 2], [2, 2], [3, 3]]) {
  const r = mixed(s, p);
  console.log(`skim ${s} + pick ${p}: stolen $${r.stolen} P(conv)=${(r.pConv * 100).toFixed(0)}% EV $${r.ev.toFixed(0)} (${r.ratio.toFixed(2)}x)`);
}
