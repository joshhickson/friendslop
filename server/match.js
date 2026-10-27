// A Match runs one game instance inside a room: it builds the `ctx` object handed to
// the game's create(), drives the tick loop, and shields the server from game bugs.

import { performance } from 'node:perf_hooks';
import { randomId } from './security.js';

const MAX_HOOK_ERRORS = 25;

export class Match {
  /**
   * @param {import('./room.js').Room} room
   * @param {object} def    game definition from defineGame()
   * @param {object} settings coerced settings
   */
  constructor(room, def, settings) {
    this.room = room;
    this.def = def;
    this.settings = Object.freeze({ ...settings });
    this.id = randomId('m_');
    this.log = room.log.child(def.id);
    this.active = new Set(); // player ids that have loaded the game and are "in" the match
    this.watchers = new Set(); // loaded spectators: receive broadcasts, invisible to game logic
    this.ended = false;
    this.errors = 0;
    this.startedAt = Date.now();
    this.time = 0;
    this.tickCount = 0;
    this.ctx = this.#makeContext();
    this.hooks = {};
  }

  start() {
    try {
      this.hooks = this.def.create(this.ctx) ?? {};
    } catch (err) {
      this.log.error('create() threw:', err);
      this.room.endMatch({ text: `The game crashed while starting: ${err.message}`, error: true });
      return;
    }
    this.lastTick = performance.now();
    this.interval = setInterval(() => this.#tick(), 1000 / this.def.tickRate);
  }

  stop() {
    if (this.ended) return;
    this.ended = true;
    clearInterval(this.interval);
    this.call('onEnd');
    this.active.clear();
    this.watchers.clear();
  }

  /** Safely invoke a game hook. Exceptions are logged instead of taking down the server. */
  call(name, ...args) {
    const fn = this.hooks[name];
    if (typeof fn !== 'function') return undefined;
    try {
      return fn.apply(this.hooks, args);
    } catch (err) {
      this.errors++;
      this.log.error(`${name}() threw:`, err);
      if (this.errors >= MAX_HOOK_ERRORS && !this.ended) {
        queueMicrotask(() => this.room.endMatch({ text: 'The game hit too many errors and was stopped. Check the server log.', error: true }));
      }
      return undefined;
    }
  }

  // ---- player lifecycle (called by Room) ----

  playerReady(player) {
    if (this.ended || this.active.has(player.id) || this.watchers.has(player.id)) return;
    if (player.spectating) {
      this.watchers.add(player.id);
      this.call('onSpectatorJoin', player.view);
      return;
    }
    this.active.add(player.id);
    this.call('onPlayerJoin', player.view);
  }

  playerGone(player) {
    if (this.watchers.delete(player.id)) return;
    if (!this.active.delete(player.id)) return;
    this.call('onPlayerLeave', player.view);
  }

  /** A loaded player switched between playing and spectating mid-match. */
  playerSpectateChanged(player) {
    if (!player.loaded || this.ended) return;
    if (player.spectating && this.active.has(player.id)) {
      this.active.delete(player.id);
      this.call('onPlayerLeave', player.view);
      this.watchers.add(player.id);
      this.call('onSpectatorJoin', player.view);
    } else if (!player.spectating && this.watchers.delete(player.id)) {
      this.active.add(player.id);
      this.call('onPlayerJoin', player.view);
    }
  }

  playerTeamChanged(player, oldTeam) {
    if (!this.active.has(player.id)) return;
    this.call('onTeamChange', player.view, oldTeam);
  }

  message(player, type, data) {
    if (!this.active.has(player.id)) return;
    this.call('onMessage', player.view, type, data);
  }

  #tick() {
    if (this.ended) return;
    const now = performance.now();
    const dt = Math.min(0.25, (now - this.lastTick) / 1000);
    this.lastTick = now;
    this.time += dt;
    this.tickCount++;
    this.ctx.dt = dt;
    this.ctx.time = this.time;
    this.ctx.tick = this.tickCount;
    this.call('tick', dt);
  }

  #makeContext() {
    const room = this.room;
    const match = this;
    const resolve = (p) => room.players.get(typeof p === 'string' ? p : p?.id);

    const ctx = {
      matchId: this.id,
      game: { id: this.def.id, name: this.def.name },
      settings: this.settings,
      teams: this.def.teams ? this.def.teams.map((t) => ({ ...t })) : null,
      log: this.log,
      time: 0, // seconds since the match started
      dt: 0, // seconds since the previous tick
      tick: 0,
      /** Server wall clock in ms. Clients can read the same clock via ctx.clock.now(). */
      now: () => Date.now(),

      /** Players currently in the match (loaded and connected). */
      players: () => [...match.active].map((id) => room.players.get(id)?.view).filter(Boolean),
      getPlayer: (id) => (match.active.has(id) ? room.players.get(id)?.view ?? null : null),
      teamPlayers: (team) => ctx.players().filter((p) => p.team === team),

      /** Loaded spectators (watching, not playing). */
      spectators: () => [...match.watchers].map((id) => room.players.get(id)?.view).filter(Boolean),

      send(target, type, data) {
        const p = resolve(target);
        if (p && (match.active.has(p.id) || match.watchers.has(p.id))) p.conn?.sendGame(type, data);
      },
      /** Everyone in the match, spectators included (they watch the same world). */
      broadcast(type, data, { except } = {}) {
        const skip = except ? resolve(except)?.id : null;
        const raw = JSON.stringify({ t: 'game', type, data }); // serialize once for everyone
        for (const set of [match.active, match.watchers]) {
          for (const id of set) {
            if (id === skip) continue;
            room.players.get(id)?.conn?.sendRaw(raw);
          }
        }
      },
      sendTeam(team, type, data) {
        for (const id of match.active) {
          const p = room.players.get(id);
          if (p?.team === team) p.conn?.sendGame(type, data);
        }
      },

      teamScore: (team) => room.teamScores[team] ?? 0,
      setTeamScore(team, value) {
        if (!(team in room.teamScores)) return;
        room.teamScores[team] = value;
        room.markDirty();
      },
      addTeamScore(team, delta = 1) {
        ctx.setTeamScore(team, ctx.teamScore(team) + delta);
        return ctx.teamScore(team);
      },

      stat: (target, key) => resolve(target)?.stats[key] ?? 0,
      setStat(target, key, value) {
        const p = resolve(target);
        if (!p) return;
        p.stats[key] = value;
        room.markDirty();
      },
      addStat(target, key, delta = 1) {
        const p = resolve(target);
        if (!p) return 0;
        p.stats[key] = (p.stats[key] ?? 0) + delta;
        room.markDirty();
        return p.stats[key];
      },

      /** Force a player onto a team (e.g. auto-balance). */
      setTeam(target, team) {
        const p = resolve(target);
        if (p) room.assignTeam(p, team);
      },

      /** Show a message in everyone's chat / feed. */
      announce(text) {
        room.systemChat(String(text));
      },

      /**
       * End the match. `result` is shown to everyone:
       *   { winner: '<teamId or playerId>', text: 'Red captured 3 flags!' }
       * `opts.resultsSeconds` overrides the game's `resultsSeconds` for this ending.
       */
      endMatch(result = {}, opts = {}) {
        queueMicrotask(() => {
          if (!match.ended && room.match === match) room.endMatch(result, opts);
        });
      },

      /** 'playing', or 'results' after endMatch() while a results period is running. */
      get phase() {
        return room.match === match ? room.phase : 'ended';
      },
    };
    return ctx;
  }
}
