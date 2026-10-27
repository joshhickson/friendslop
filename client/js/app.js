// Client entry point: connects, routes server messages into the store, and swaps screens.

import { Net } from './net.js';
import { h, toast } from './dom.js';
import { store, session } from './state.js';
import { homeScreen } from './screens/home.js';
import { lobbyScreen } from './screens/lobby.js';
import { matchScreen } from './screens/match.js';
import { C2S, S2C } from '/shared/protocol.js';

const appEl = document.getElementById('app');
const net = new Net();
const params = new URLSearchParams(location.search);
let screen = null;
let screenKind = null;
let screenKey = null;
let banner = null;

const app = {
  setTitle(extra) {
    document.title = extra ? `${extra} · Friendslop` : 'Friendslop';
  },
};

function show(kind, key, make) {
  if (screenKind === kind && screenKey === key) return;
  screen?.destroy?.();
  appEl.replaceChildren();
  screenKind = kind;
  screenKey = key;
  screen = make();
  appEl.append(screen.el);
}

function route() {
  const room = store.room;
  if (!room) {
    show('home', null, () => homeScreen(net, { prefillCode: params.get('room') ?? '', preferGame: params.get('game') ?? '' }));
    app.setTitle();
  } else if (room.match && (room.phase === 'playing' || (room.phase === 'results' && screenKind === 'match' && screenKey === room.match.matchId))) {
    // During a results period the match screen stays up for players who were in it.
    show('match', room.match.matchId, () => matchScreen(net, app));
    app.setTitle(`${room.game.name} · ${room.id}`);
  } else {
    show('lobby', room.id, () => lobbyScreen(net));
    app.setTitle(`Lobby ${room.id}`);
  }
}

function setBanner(text) {
  banner?.remove();
  banner = text ? h('div.conn-banner', text) : null;
  if (banner) document.body.append(banner);
}

// ---------- server → client ----------

net.on('open', (hello) => {
  setBanner(null);
  store.set({ hello });
  // Rejoin the same seat after a refresh or a dropped connection.
  const saved = session.load();
  if (saved) net.send(C2S.JOIN, { roomId: saved.roomId, token: saved.token, resume: true });
  else route();
});

net.on('close', ({ wasConnected }) => {
  setBanner(wasConnected ? 'Disconnected from the server. Reconnecting…' : 'Cannot reach the server. Is it running? Retrying…');
});

net.on(S2C.WELCOME, (msg) => {
  session.save(msg.room.id, msg.token);
  store.set({ me: msg.you, room: msg.room, chat: msg.chat ?? [] });
  history.replaceState(null, '', `/?room=${msg.room.id}`);
  store.emit('room');
  store.emit('chat');
  // The server forgets our in-match state on reconnect, so always rebuild the screen
  // (a running game re-mounts and re-announces itself as ready).
  screenKind = null;
  route();
});

net.on(S2C.ROOM, (msg) => {
  store.room = msg.room;
  store.emit('room');
  route();
});

net.on(S2C.CHAT, (msg) => {
  store.chat.push(msg);
  if (store.chat.length > 60) store.chat.shift();
  store.emit('chat');
});

net.on(S2C.MATCH_START, () => {
  // The following ROOM update carries the full state; nothing else to do here.
});

net.on(S2C.MATCH_END, ({ result }) => {
  // A game that registered api.onMatchEnd() shows its own ending; otherwise fall back to a toast.
  const handled = screenKind === 'match' && screen?.matchEnded?.(result);
  if (store.room) {
    store.room = result.returnAt
      ? { ...store.room, phase: 'results', lastResult: result }
      : { ...store.room, phase: 'lobby', match: null, lastResult: result };
    store.emit('room');
    route();
  }
  if (!handled) toast(result.text, result.error ? 'error' : 'ok', 5000);
});

net.on(S2C.LEFT, ({ reason }) => {
  session.clear();
  store.set({ room: null, me: null, chat: [] });
  history.replaceState(null, '', '/');
  if (reason === 'kicked') toast('You were kicked from the room.', 'error');
  else if (reason === 'replaced') toast('This seat was taken over by another tab.', 'error');
  else if (reason === 'timeout') toast('You were disconnected for too long.', 'error');
  else if (reason === 'idle') toast('The room closed because nobody had played for a while.', 'error');
  route();
});

net.on(S2C.ERROR, ({ code, message }) => {
  // A stale saved session (server restarted, room closed): quietly go home.
  if (session.load() && !store.room && (code === 'room_not_found' || code === 'session_expired' || code === 'locked_out')) {
    session.clear();
    route();
    return;
  }
  toast(message, 'error');
});

net.connect();

// Expose for debugging in the browser console.
window.friendslop = { net, store };
