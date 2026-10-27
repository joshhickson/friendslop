// Time-indexed sample buffer. Two common uses:
//   - Server: remember where each player was recently, to rewind for lag compensation.
//   - Client: buffer network snapshots and render them slightly in the past (interpolation).

export class History {
  /**
   * @param {number} keepMs how long to keep samples
   * @param {(a, b, t) => any} [lerpFn] blends two samples; defaults to "take the newer one"
   */
  constructor(keepMs = 1000, lerpFn = null) {
    this.keepMs = keepMs;
    this.lerpFn = lerpFn;
    this.samples = []; // [{ t, v }] sorted by t
  }

  push(t, v) {
    const s = this.samples;
    if (s.length && t < s[s.length - 1].t) {
      // Out-of-order sample: insert in place (rare).
      let i = s.length - 1;
      while (i > 0 && s[i - 1].t > t) i--;
      s.splice(i, 0, { t, v });
    } else {
      s.push({ t, v });
    }
    const cutoff = s[s.length - 1].t - this.keepMs;
    let drop = 0;
    while (drop < s.length - 2 && s[drop + 1].t < cutoff) drop++;
    if (drop) s.splice(0, drop);
  }

  latest() {
    return this.samples.length ? this.samples[this.samples.length - 1].v : undefined;
  }

  clear() {
    this.samples.length = 0;
  }

  /** Value at time `t`, interpolated between neighbours (clamped to the buffer's ends). */
  at(t) {
    const s = this.samples;
    if (!s.length) return undefined;
    if (t <= s[0].t) return s[0].v;
    const last = s[s.length - 1];
    if (t >= last.t) return last.v;
    let i = s.length - 1;
    while (i > 0 && s[i - 1].t > t) i--;
    const a = s[i - 1];
    const b = s[i];
    if (!this.lerpFn) return a.v;
    const span = b.t - a.t;
    return this.lerpFn(a.v, b.v, span > 0 ? (t - a.t) / span : 1);
  }
}
