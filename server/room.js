// A Room is a password-protected group of players with a host, a selected game,
// teams, and (while playing) a running Match.

import { Match } from './match.js';
import { coerceSettings } from './kit/defineGame.js';
import { randomId, randomToken } from './security.js';
import { S2C, cleanText, LIMITS } from '../shared/protocol.js';

const CHAT_HISTORY = 40;
const HOST_HANDOFF_MS = 5000;
// Seats beyond the game's player limit, for spectators (e.g. a host watching a full 10v10 of bots).
const SPECTATOR_SEATS = 4;

class Player {
  constructor(name) {
    this.id = randomId('p_');
    this.name = name;
    this.token = randomToken();
    this.team = null;
    this.conn = null;
    this.stats = {};
    this.ping = 0;
    this.joinedAt = Date.now();
    this.graceTimer = null;
    this.loaded = false; // loaded the current match on the client
    this.everConnected = false;
    this.bot = false; // self-declared or host-added bot (shown with a badge, never made host)
    this.filler = false; // bot added automatically to fill a team (leaves when the match ends)
    this.spectating = false; // watches the match without taking part (games never see spectators as players)
    this.matchTeam = null; // team this player first played on in the current match (for the team-switch lock)

    const self = this;
    // Read-only, always-current view of the player that is handed to game code.
    this.view = Object.freeze({
      get id() { return self.id; },
      get name() { return self.name; },
      get team() { return self.team; },
      get ping() { return self.ping; },
      get connected() { return Boolean(self.conn); },
      get bot() { return self.bot; },
      get spectating() { return self.spectating; },
      get stats() { return { ...self.stats }; },
    });
  }

  get connected() {
    return Boolean(this.conn);
  }
}

export class Room {
  /**
   * @param {object} opts
   * @param {string} opts.id
   * @param {{salt: Buffer, key: Buffer} | null} opts.password
   * @param {object} opts.def game definition
   * @param {object} opts.owner  the RoomManager: { config, log, games, removeRoom(room) }
   */
  constructor({ id, password, def, owner }) {
    this.id = id;
    this.password = password;
    this.owner = owner;
    this.config = owner.config;
    this.log = owner.log.child(id);
    this.players = new Map();
    this.hostId = null;
    this.phase = 'lobby';
    this.match = null;
    this.lastResult = null;
    this.chat = [];
    this.dirty = false;
    this.flushTimer = null;
    this.createdAt = Date.now();
    this.lastActivity = this.createdAt; // last message from a human (bots don't count)
    this.#setGame(def);
  }

  get hasPassword() {
    return Boolean(this.password);
  }

  get connectedCount() {
    let n = 0;
    for (const p of this.players.values()) if (p.conn) n++;
    return n;
  }

  /** Players who can be on teams at once (the game's maxPlayers, capped by server config). */
  get maxPlayers() {
    return Math.min(this.def.maxPlayers, this.config.maxPlayersPerRoom);
  }

  /** Total seats in the room: playing slots plus a few extra for spectators. */
  get maxSeats() {
    return this.maxPlayers + SPECTATOR_SEATS;
  }

  /** Does the server hold a bot brain for this room's game? Games from a GitHub source never run here. */
  #hasBotBrain() {
    return !this.def.source && Boolean(this.owner.bots?.hasBrain(this.def.id));
  }

  /** Will bots top the teams up when the match starts? (game has autoFill, and it's switched on) */
  get willAutoFill() {
    const fill = this.def.autoFill;
    return Boolean(fill && (!fill.setting || this.settings[fill.setting]) && this.#hasBotBrain());
  }

  /** Players currently taking a playing slot (spectators don't). */
  get playingCount() {
    let n = 0;
    for (const p of this.players.values()) if (!p.spectating) n++;
    return n;
  }

  /** Is there a playing slot free for one more player? */
  get hasPlayingSlot() {
    return this.playingCount < this.maxPlayers;
  }

  #setGame(def, settingsInput = {}) {
    this.def = def;
    this.settings = coerceSettings(def.settings, settingsInput);
    // Framework-level room options the host controls, independent of the game's own settings.
    this.options = { teamSwitch: def.teamChangeInProgress };
    this.teamScores = {};
    if (def.teams) for (const t of def.teams) this.teamScores[t.id] = 0;
    this.lastResult = null;
    for (const p of this.players.values()) {
      p.team = null;
      p.stats = {};
    }
    for (const p of this.players.values()) if (!p.spectating) p.team = this.#autoTeam(p);
  }

  /** Players taking part (not spectating). */
  get participantCount() {
    let n = 0;
    for (const p of this.players.values()) if (p.conn && !p.spectating) n++;
    return n;
  }

  // ---- membership -----------------------------------------------------------

  /** Adds a new player. Caller has already checked password / capacity. */
  addPlayer(name, conn, { bot = false, team = 'auto' } = {}) {
    const p = new Player(this.#uniqueName(name));
    p.bot = bot;
    // No playing slot left (the teams are full): humans come in as spectators.
    if (!bot && !this.hasPlayingSlot) p.spectating = true;
    this.players.set(p.id, p);
    if (!this.hostId && !bot) this.hostId = p.id;
    p.team = p.spectating ? null : this.def.teams?.some((t) => t.id === team) ? team : this.#autoTeam(p);
    this.attach(p, conn);
    this.systemChat(`${p.name} joined.`);
    if (!bot) this.balanceBots();
    return p;
  }

  get humanCount() {
    let n = 0;
    for (const p of this.players.values()) if (!p.bot) n++;
    return n;
  }

  /** Host action: add `count` bots (each one is a separate WebSocket client). Returns an error code or null. */
  addBots({ count = 1, team = 'auto', difficulty = 'normal' } = {}) {
    const bots = this.owner.bots;
    if (!this.#hasBotBrain()) return 'no_bots';
    if (team !== 'auto' && !this.def.teams?.some((t) => t.id === team)) return 'bad_team';
    const n = Math.max(0, Math.min(Math.floor(Number(count) || 0), this.maxPlayers - this.playingCount - this.#pendingBots()));
    if (n === 0) return 'room_full';
    const diff = ['easy', 'normal', 'hard'].includes(difficulty) ? difficulty : 'normal';
    for (let i = 0; i < n; i++) {
      bots.spawn(this, { team, difficulty: diff }).catch((err) => this.log.warn(`bot failed to join: ${err.message}`));
    }
    return null;
  }

  /**
   * For games with `autoFill`: top both teams up to `perTeam` with bots, and remove surplus bots
   * when humans take their places. Runs at match start and whenever players come and go mid-match.
   */
  balanceBots() {
    const fill = this.def.autoFill;
    if (!fill || !this.match || this.phase !== 'playing' || this.balancing) return;
    if (fill.setting && !this.settings[fill.setting]) return;
    const bots = this.owner.bots;
    if (!this.#hasBotBrain()) return;
    const difficulty = fill.difficultySetting ? this.settings[fill.difficultySetting] : 'normal';
    const pending = bots.pending(this);
    for (const t of this.def.teams) {
      const members = [...this.players.values()].filter((p) => p.team === t.id && !p.spectating);
      const have = members.length + (pending[t.id] ?? 0);
      const free = this.maxPlayers - this.playingCount - this.#pendingBots();
      if (have < fill.perTeam) {
        for (let i = 0; i < Math.min(fill.perTeam - have, free); i++) {
          bots.spawn(this, { team: t.id, difficulty, filler: true }).catch((err) => this.log.warn(`bot failed to join: ${err.message}`));
        }
      } else if (have > fill.perTeam) {
        // Too many: drop this team's bots, newest first (humans are never removed).
        const extra = members.filter((p) => p.bot).sort((a, b) => (b.filler - a.filler) || (b.joinedAt - a.joinedAt)).slice(0, have - fill.perTeam);
        this.balancing = true;
        try {
          for (const p of extra) this.removePlayer(p, 'kicked');
        } finally {
          this.balancing = false;
        }
      }
    }
  }

  #pendingBots() {
    return Object.values(this.owner.bots?.pending(this) ?? {}).reduce((a, b) => a + b, 0);
  }

  /** Host action: remove one bot by id, or every bot with 'all'. */
  removeBots(which) {
    for (const p of [...this.players.values()]) {
      if (p.bot && (which === 'all' || p.id === which)) this.removePlayer(p, 'kicked');
    }
  }

  findByToken(token) {
    if (typeof token !== 'string') return null;
    for (const p of this.players.values()) if (p.token === token) return p;
    return null;
  }

  /** Binds a connection to a player (new join or reconnect). */
  attach(player, conn) {
    if (player.conn && player.conn !== conn) player.conn.detach('replaced');
    clearTimeout(player.graceTimer);
    player.graceTimer = null;
    const isReconnect = player.everConnected && !player.conn;
    player.conn = conn;
    player.everConnected = true;
    player.loaded = false;
    conn.bind(this, player);
    conn.send(S2C.WELCOME, { you: player.id, token: player.token, room: this.snapshot(), chat: this.chat });
    if (isReconnect) this.systemChat(`${player.name} reconnected.`);
    this.markDirty();
  }

  /** Connection dropped unexpectedly: keep the seat for a grace period so the player can reconnect. */
  disconnected(player) {
    if (!player.conn) return;
    player.conn = null;
    player.loaded = false;
    this.match?.playerGone(player);
    clearTimeout(player.graceTimer);
    player.graceTimer = setTimeout(() => this.removePlayer(player, 'timeout'), this.config.reconnectGraceMs);
    player.graceTimer.unref?.();
    // Don't leave the room stuck behind an offline host, but give a refreshing host a moment to come back.
    if (this.hostId === player.id) {
      clearTimeout(this.hostTimer);
      this.hostTimer = setTimeout(() => this.ensureConnectedHost(), HOST_HANDOFF_MS);
      this.hostTimer.unref?.();
    }
    this.markDirty();
  }

  /** Player is gone for good (left, kicked, or reconnect grace expired). */
  removePlayer(player, reason = 'left') {
    if (!this.players.has(player.id)) return;
    clearTimeout(player.graceTimer);
    this.match?.playerGone(player);
    this.players.delete(player.id);
    if (player.conn) {
      const conn = player.conn;
      player.conn = null;
      conn.unbind();
      conn.send(S2C.LEFT, { reason });
    }
    const verb = reason === 'kicked' ? 'was kicked' : reason === 'timeout' ? 'disconnected' : 'left';
    this.systemChat(`${player.name} ${verb}.`);

    if (this.hostId === player.id) this.#pickNewHost();
    // Bots never keep a room alive on their own.
    if (this.humanCount === 0) {
      this.destroy();
      return;
    }
    if (!player.bot) this.balanceBots();
    this.markDirty();
  }

  #pickNewHost() {
    const candidates = [...this.players.values()].filter((p) => !p.bot).sort((a, b) => (b.connected - a.connected) || (a.joinedAt - b.joinedAt));
    this.hostId = candidates[0]?.id ?? null;
    const host = this.players.get(this.hostId);
    if (host) this.systemChat(`${host.name} is now the host.`);
  }

  /** If the host has dropped, hand host to someone who is still here. */
  ensureConnectedHost() {
    const host = this.players.get(this.hostId);
    if (host?.connected) return;
    const next = [...this.players.values()].filter((p) => p.connected && !p.bot).sort((a, b) => a.joinedAt - b.joinedAt)[0];
    if (next) {
      this.hostId = next.id;
      this.systemChat(`${next.name} is now the host.`);
      this.markDirty();
    }
  }

  #uniqueName(name) {
    const taken = new Set([...this.players.values()].map((p) => p.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    for (let i = 2; ; i++) {
      const suffix = ` ${i}`;
      const candidate = name.slice(0, LIMITS.NAME_MAX - suffix.length) + suffix;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
  }

  // ---- teams ----------------------------------------------------------------

  #autoTeam(except) {
    if (!this.def.teams) return null;
    const counts = Object.fromEntries(this.def.teams.map((t) => [t.id, 0]));
    for (const p of this.players.values()) if (p !== except && p.team in counts) counts[p.team]++;
    let best = this.def.teams[0].id;
    for (const t of this.def.teams) if (counts[t.id] < counts[best]) best = t.id;
    return best;
  }

  /**
   * A player picks a team, 'auto', or 'spectate'. Returns an error code or null.
   * With team switching off (room option), a player can always drop to spectating but can only
   * come back on the team they first played on this match, so spectating can't be used to switch.
   */
  pickTeam(player, team) {
    if (player.bot && team === 'spectate') return 'bad_team';
    if (team === 'spectate') {
      this.#setSpectating(player, true);
      return null;
    }
    if (!this.def.teams) {
      if (team !== 'auto') return 'bad_team';
      if (player.spectating && !this.hasPlayingSlot) return 'room_full';
      this.#setSpectating(player, false);
      return null;
    }
    const target = team === 'auto' ? (player.matchTeam && !this.options.teamSwitch && this.match ? player.matchTeam : this.#autoTeam(player)) : team;
    if (!this.def.teams.some((t) => t.id === target)) return 'bad_team';
    const locked = this.match && !this.options.teamSwitch && player.matchTeam && player.matchTeam !== target;
    if (locked) return 'team_locked';
    if (player.spectating) {
      if (!this.hasPlayingSlot && !this.#freeBotSlot(target)) return 'room_full';
      // Coming back from spectating: set the team first so the game sees the right one on join.
      player.team = target;
      this.#setSpectating(player, false);
    } else {
      this.assignTeam(player, target);
    }
    return null;
  }

  /**
   * Teams are full, but in an auto-filled game a bot can make way for a human: remove one of
   * `team`'s bots (or any bot) and report whether a slot was freed.
   */
  #freeBotSlot(team) {
    if (!this.def.autoFill) return false;
    const bots = [...this.players.values()].filter((p) => p.bot && !p.spectating);
    const victim = bots.filter((p) => p.team === team).sort((a, b) => b.joinedAt - a.joinedAt)[0] ?? bots.sort((a, b) => b.joinedAt - a.joinedAt)[0];
    if (!victim) return false;
    this.balancing = true;
    try {
      this.removePlayer(victim, 'kicked');
    } finally {
      this.balancing = false;
    }
    return true;
  }

  #setSpectating(player, on) {
    if (player.spectating === on) {
      this.markDirty();
      return;
    }
    player.spectating = on;
    if (on) player.team = null;
    else if (this.def.teams && !this.def.teams.some((t) => t.id === player.team)) player.team = this.#autoTeam(player);
    if (!on && this.match && !player.matchTeam) player.matchTeam = player.team;
    const teamName = this.def.teams?.find((t) => t.id === player.team)?.name;
    this.systemChat(on ? `${player.name} is spectating.` : `${player.name} joined${teamName ? ` ${teamName}` : ' the game'}.`);
    this.match?.playerSpectateChanged(player);
    this.balanceBots();
    this.markDirty();
  }

  assignTeam(player, team) {
    if (player.team === team) {
      this.markDirty();
      return;
    }
    const old = player.team;
    player.team = team;
    if (this.match && !player.matchTeam && !player.spectating) player.matchTeam = team;
    const teamName = this.def.teams?.find((t) => t.id === team)?.name ?? team;
    if (this.phase === 'playing') this.systemChat(`${player.name} joined ${teamName}.`);
    this.match?.playerTeamChanged(player, old);
    if (!player.bot) this.balanceBots();
    this.markDirty();
  }

  // ---- host actions -----------------------------------------------------------

  configure(input) {
    if (this.phase !== 'lobby') return 'bad_phase';
    if (input.game && this.def.source) return 'bad_request'; // a game from a GitHub source cannot be swapped
    if (input.game && input.game !== this.def.id) {
      const def = this.owner.games.get(input.game);
      if (!def) return 'unknown_game';
      this.#setGame(def, input.settings);
      this.systemChat(`Game changed to ${def.name}.`);
    } else if (input.settings && typeof input.settings === 'object') {
      this.settings = coerceSettings(this.def.settings, input.settings, this.settings);
    }
    if (input.options && typeof input.options === 'object' && typeof input.options.teamSwitch === 'boolean') {
      this.options = { ...this.options, teamSwitch: input.options.teamSwitch };
    }
    this.markDirty();
    return null;
  }

  startMatch() {
    if (this.phase !== 'lobby') return 'bad_phase';
    if (this.owner.traffic?.overBudget) return 'traffic_budget';
    // Games that fill teams with bots can start with nobody playing (e.g. a spectating host).
    if (this.participantCount < this.def.minPlayers && !this.willAutoFill) return 'not_enough_players';
    for (const t of Object.keys(this.teamScores)) this.teamScores[t] = 0;
    for (const p of this.players.values()) {
      p.stats = {};
      p.loaded = false;
      if (!p.spectating && this.def.teams && !this.def.teams.some((t) => t.id === p.team)) p.team = this.#autoTeam(p);
      p.matchTeam = p.spectating ? null : p.team;
    }
    this.lastResult = null;
    this.phase = 'playing';
    this.match = new Match(this, this.def, this.settings);
    this.log.info(`match ${this.match.id} started (${this.def.id}, ${this.connectedCount} players)`);
    this.broadcast(S2C.MATCH_START, this.matchInfo());
    this.match.start();
    this.balanceBots();
    this.markDirty();
    return null;
  }

  /**
   * Ends the match. With a results period (the game's `resultsSeconds`, or `opts.resultsSeconds`)
   * the room enters the 'results' phase: the match keeps running and stays on screen so the
   * game can show its own ending, then everyone returns to the lobby. Without one, it's immediate.
   */
  endMatch(result = {}, opts = {}) {
    if (!this.match || this.phase !== 'playing') return;
    const match = this.match;
    const seconds = result.error ? 0 : Math.min(60, Math.max(0, Number(opts.resultsSeconds ?? this.def.resultsSeconds) || 0));
    this.lastResult = {
      winner: typeof result.winner === 'string' ? result.winner : null,
      text: cleanText(String(result.text ?? 'Match over.'), 200),
      error: Boolean(result.error),
      teamScores: { ...this.teamScores },
      stats: Object.fromEntries([...this.players.values()].map((p) => [p.id, { name: p.name, team: p.team, ...p.stats }])),
      at: Date.now(),
      returnAt: seconds > 0 ? Date.now() + seconds * 1000 : null,
    };
    this.log.info(`match ${match.id} ended: ${this.lastResult.text}`);
    if (seconds > 0) {
      this.phase = 'results';
      this.resultsTimer = setTimeout(() => this.returnToLobby(), seconds * 1000);
      this.resultsTimer.unref?.();
      match.call('onResults', this.lastResult);
    } else {
      this.#closeMatch();
    }
    this.broadcast(S2C.MATCH_END, { result: this.lastResult });
    this.markDirty();
  }

  /** Ends the results period early (host skip) or when its timer runs out. */
  returnToLobby() {
    if (this.phase !== 'results') return;
    this.#closeMatch();
    this.markDirty();
  }

  #closeMatch() {
    clearTimeout(this.resultsTimer);
    const match = this.match;
    this.match = null;
    match?.stop();
    this.phase = 'lobby';
    for (const p of this.players.values()) {
      p.loaded = false;
      p.matchTeam = null;
    }
    // Bots that only joined to fill the teams leave with the match; the next one refills.
    const fillers = [...this.players.values()].filter((p) => p.filler);
    if (fillers.length) {
      this.balancing = true;
      try {
        for (const p of fillers) this.removePlayer(p, 'left');
      } finally {
        this.balancing = false;
      }
    }
  }

  matchInfo() {
    if (!this.match) return null;
    return { matchId: this.match.id, game: this.def.id, settings: this.match.settings };
  }

  // ---- player messages during a match ---------------------------------------

  playerLoaded(player) {
    if (!this.match || player.loaded) return;
    player.loaded = true;
    this.match.playerReady(player);
    this.markDirty();
  }

  gameMessage(player, type, data) {
    this.match?.message(player, type, data);
  }

  // ---- chat -----------------------------------------------------------------

  chatFrom(player, text) {
    const msg = { from: player.id, name: player.name, team: player.team, text, at: Date.now() };
    this.#pushChat(msg);
  }

  systemChat(text) {
    this.#pushChat({ from: null, name: null, team: null, text, system: true, at: Date.now() });
  }

  #pushChat(msg) {
    this.chat.push(msg);
    if (this.chat.length > CHAT_HISTORY) this.chat.shift();
    this.broadcast(S2C.CHAT, msg);
  }

  // ---- state sync -----------------------------------------------------------

  broadcast(type, data) {
    const raw = JSON.stringify({ t: type, ...data });
    for (const p of this.players.values()) p.conn?.sendRaw(raw);
  }

  /** Coalesces room-state broadcasts so a burst of changes produces one update. */
  markDirty() {
    this.dirty = true;
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      if (!this.dirty) return;
      this.dirty = false;
      this.broadcast(S2C.ROOM, { room: this.snapshot() });
    }, 50);
  }

  snapshot() {
    const def = this.def;
    return {
      id: this.id,
      hasPassword: this.hasPassword,
      hostId: this.hostId,
      phase: this.phase,
      maxPlayers: this.maxPlayers,
      maxSeats: this.maxSeats,
      game: {
        id: def.id,
        source: def.source ?? null,
        name: def.name,
        description: def.description,
        minPlayers: def.minPlayers,
        maxPlayers: def.maxPlayers,
        teams: def.teams,
        settings: def.settings,
        scoreboard: def.scoreboard,
        controls: def.controls,
        teamChangeInProgress: def.teamChangeInProgress,
      },
      settings: this.settings,
      options: this.options,
      teamScores: this.teamScores,
      botsSupported: def.source ? def.hasBot : Boolean(this.owner.bots?.hasBrain(def.id)),
      // Bots will fill the teams to this many each at match start (null: no auto-fill).
      autoFill: this.willAutoFill ? def.autoFill.perTeam : null,
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        bot: p.bot,
        spectating: p.spectating,
        // Set while team switching is off mid-match: the only team this player may (re)join.
        lockedTeam: this.match && !this.options.teamSwitch ? p.matchTeam : null,
        team: p.team,
        connected: p.connected,
        inMatch: p.loaded,
        ping: p.ping,
        stats: p.stats,
      })),
      match: this.matchInfo(),
      lastResult: this.lastResult,
    };
  }

  /** Closes the room for a server reason (e.g. 'idle'): everyone is told why, then it's destroyed. */
  close(reason) {
    for (const p of this.players.values()) {
      if (p.bot || !p.conn) continue;
      const conn = p.conn;
      p.conn = null;
      conn.unbind();
      conn.send(S2C.LEFT, { reason });
    }
    this.destroy();
  }

  destroy() {
    clearTimeout(this.flushTimer);
    clearTimeout(this.resultsTimer);
    clearTimeout(this.hostTimer);
    if (this.match) {
      const m = this.match;
      this.match = null;
      m.stop();
    }
    for (const p of this.players.values()) {
      clearTimeout(p.graceTimer);
      const conn = p.conn;
      conn?.unbind();
      // Tell bot connections the room is gone so they disconnect instead of idling.
      if (p.bot) conn?.send(S2C.LEFT, { reason: 'closed' });
    }
    this.players.clear();
    this.owner.removeRoom(this);
  }
}
