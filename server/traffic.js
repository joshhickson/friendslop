// Running matches may go on past the budget, but only this far past it.
export const HARD_LIMIT = 1.25;

/**
 * Counts the bytes the server sends to players each day (UTC), for hosts with a bandwidth cap.
 * With a budget set, `overBudget` turns true once the day's total passes it, and new rooms
 * and matches are refused until the next UTC day. Matches already running go on until the
 * day's total reaches HARD_LIMIT times the budget; then `onHardLimit` is called (once a day,
 * outside the send that crossed it) to end them.
 */
export class TrafficMeter {
  constructor({ dailyMb = 0, log, now = () => Date.now(), onHardLimit = null } = {}) {
    this.budget = dailyMb > 0 ? dailyMb * 1024 * 1024 : 0;
    this.onHardLimit = onHardLimit;
    this.log = log;
    this.now = now;
    this.day = this.#today();
    this.bytes = 0;
    this.warned = false;
  }

  #today() {
    return new Date(this.now()).toISOString().slice(0, 10);
  }

  #roll() {
    const today = this.#today();
    if (today === this.day) return;
    this.day = today;
    this.bytes = 0;
    this.warned = false;
  }

  add(n) {
    this.#roll();
    const was = this.bytes;
    this.bytes += n;
    if (!this.budget) return;
    if (!this.warned && this.bytes >= this.budget * 0.8) {
      this.warned = true;
      this.log?.warn(`traffic: 80% of today's ${this.budget / 1024 / 1024} MB budget used`);
    }
    if (was < this.budget && this.bytes >= this.budget) {
      this.log?.warn('traffic: daily budget used up; new rooms and matches are refused until midnight UTC');
    }
    const hard = this.budget * HARD_LIMIT;
    if (was < hard && this.bytes >= hard) {
      this.log?.warn(`traffic: ${HARD_LIMIT * 100}% of the daily budget used; ending every running match`);
      // Not from inside the send that crossed it: ending a match sends more.
      if (this.onHardLimit) queueMicrotask(() => this.onHardLimit());
    }
  }

  get overBudget() {
    this.#roll();
    return this.budget > 0 && this.bytes >= this.budget;
  }

  stats() {
    this.#roll();
    const mb = (b) => Math.round((b / 1024 / 1024) * 10) / 10;
    return { day: this.day, sentMb: mb(this.bytes), budgetMb: this.budget ? mb(this.budget) : null };
  }
}
