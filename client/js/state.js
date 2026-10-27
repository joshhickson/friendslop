// Client-side app state + helpers derived from the room snapshot.

import { Emitter } from './net.js';

export const store = new (class Store extends Emitter {
  constructor() {
    super();
    this.hello = null;    // { games: [...] }
    this.room = null;     // latest room snapshot
    this.me = null;       // my player id
    this.chat = [];
  }

  set(patch) {
    Object.assign(this, patch);
    this.emit('change', this);
  }

  get myPlayer() {
    return this.room?.players.find((p) => p.id === this.me) ?? null;
  }

  get isHost() {
    return Boolean(this.room && this.room.hostId === this.me);
  }

  team(id) {
    return this.room?.game.teams?.find((t) => t.id === id) ?? null;
  }

  teamColor(id) {
    return this.team(id)?.color ?? '#cccccc';
  }
})();

// Per-tab session so two browser windows act as two different players,
// and a refresh rejoins the same seat.
const SESSION_KEY = 'friendslop.session';
const NAME_KEY = 'friendslop.name';

export const session = {
  load() {
    try {
      return JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null');
    } catch {
      return null;
    }
  },
  save(roomId, token) {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ roomId, token }));
  },
  clear() {
    sessionStorage.removeItem(SESSION_KEY);
  },
};

export const savedName = {
  get: () => sessionStorage.getItem(NAME_KEY) ?? localStorage.getItem(NAME_KEY) ?? '',
  set(name) {
    sessionStorage.setItem(NAME_KEY, name);
    localStorage.setItem(NAME_KEY, name);
  },
};
