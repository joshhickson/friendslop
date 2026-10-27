// Lobby bots for rooms whose game runs in the host's browser (a GitHub source). Such a bot is a
// player with no socket: the room tracks it like any player, the host's runner hears it join
// and leave, and the runner runs its brain locally. The server never runs game or bot code here.

import { pickBotName } from './manager.js';

/**
 * The no-op stand-in for a Connection, held by a bot the runner controls. It never receives
 * anything, and it is not a socket: it counts toward no per-IP limit, no traffic budget and not
 * toward `wss.clients`.
 */
export class VirtualConn {
  ip = 'virtual';
  closed = false;
  bind() {}
  unbind() {}
  detach() {}
  send() {}
  sendRaw() {}
  sendGame() {}
  close() {}
}

/** What `room.bots` is for a remote game: the same surface as BotManager, without any sockets. */
export class VirtualBots {
  constructor(room) {
    this.room = room;
  }

  /** The runner holds the brain, and the game says whether it has one. */
  hasBrain() {
    return this.room.def.hasBot === true;
  }

  /** Adds one bot at once. Returns a promise only to match BotManager.spawn. */
  async spawn(room, { team = 'auto', difficulty = 'normal', filler = false, quiet = false } = {}) {
    const p = room.addPlayer(pickBotName(room), new VirtualConn(), { bot: true, team, quiet });
    p.filler = filler;
    p.difficulty = difficulty;
    // Nothing has to load for a bot: it is in the match as soon as there is one.
    if (room.match) room.playerLoaded(p);
    return p;
  }

  /** Nothing is ever in flight: a virtual bot is added in the same call. */
  pending() {
    return {};
  }
}
