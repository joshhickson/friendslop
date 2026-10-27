// Tiny timing helpers driven by your game's own clock (seconds), so they work
// identically in a server tick loop and a client render loop.

/** Rate limiter for actions such as firing: `if (gun.ready(ctx.time)) { gun.trigger(ctx.time); ... }` */
export class Cooldown {
  constructor(seconds) {
    this.seconds = seconds;
    this.until = -Infinity;
  }

  ready(now) {
    return now >= this.until;
  }

  trigger(now, seconds = this.seconds) {
    this.until = now + seconds;
  }

  /** ready() + trigger() in one call. Returns true if the action may happen. */
  use(now, seconds = this.seconds) {
    if (now < this.until) return false;
    this.until = now + seconds;
    return true;
  }

  remaining(now) {
    return Math.max(0, this.until - now);
  }

  reset() {
    this.until = -Infinity;
  }
}

/** Schedules callbacks against a clock you advance yourself: `timers.update(ctx.time)` once per tick. */
export class Scheduler {
  constructor() {
    this.items = [];
    this.now = 0;
  }

  after(seconds, fn) {
    const item = { at: this.now + seconds, fn, cancelled: false };
    this.items.push(item);
    return () => { item.cancelled = true; };
  }

  update(now) {
    this.now = now;
    const due = this.items.filter((i) => !i.cancelled && i.at <= now);
    this.items = this.items.filter((i) => !i.cancelled && i.at > now);
    for (const item of due) item.fn();
  }

  clear() {
    this.items = [];
  }
}
