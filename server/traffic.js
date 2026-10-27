/**
 * Counts the bytes the server sends to players each day (UTC), for hosts with a bandwidth cap.
 * With a budget set, `overBudget` turns true once the day's total passes it, and new rooms
 * and matches are refused until the next UTC day.
 */
export class TrafficMeter {
  constructor({ dailyMb = 0, log, now = () => Date.now() } = {}) {
    this.budget = dailyMb > 0 ? dailyMb * 1024 * 1024 : 0;
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
