// The friendslop page's side of the sandboxed game frame (client/frame/boot.js has the protocol).
// The frame runs a game from GitHub with an opaque origin. This page owns the WebSocket and the
// overlay, and passes messages between them and the frame.
//
// Everything the frame says is untrusted: it is accepted only from this frame's window, checked
// for shape and size, and any text in it is shown as text, never as HTML.

import { toast } from './dom.js';
import { C2S, S2C, LIMITS } from '/shared/protocol.js';
import { COPY } from '/shared/copy.js';

const ROLES = new Set(['inspect', 'player', 'host']);
const TOAST_KINDS = new Set(['info', 'ok', 'error']);
const UI_ACTIONS = new Set(['openMenu', 'openTeamPicker', 'showScorebar', 'showHint']);
const KEYS = new Set(['Tab', 'Enter', 'NumpadEnter', 'Escape']);
const TYPE_MAX = 64; // the server's cap on a game message type
const TEXT_MAX = 1000; // error and toast text from the frame
const META_MAX = 64 * 1024;
const CLOCK_MS = 2000;
const READY_WAIT_MS = 5000;
const BUFFER_MAX = 20_000; // relay messages held before the host's frame takes them

/** The JSON size of a value, or Infinity if it is not plain data. */
function jsonSize(v) {
  try {
    const s = JSON.stringify(v);
    return s === undefined ? 0 : s.length;
  } catch {
    return Infinity;
  }
}

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const cut = (s, max) => String(s).slice(0, max);

// ---- relay messages that arrive before the host's frame exists ----
//
// The server sends the runner relay:event `start` (and lobby bots' joins) as the match starts,
// before the room snapshot that opens the match screen, so the page has to hold them from the
// start. Each `start` begins a new batch; the host's frame takes the batch for its match.

const relayBuffers = new WeakMap();

/** Starts holding relay:event and relay:in messages for the host's frame. Call once per Net. */
export function bufferRelays(net) {
  if (relayBuffers.has(net)) return;
  const buf = { matchId: null, msgs: [], sink: null };
  const onMsg = (msg) => {
    if (buf.sink) return buf.sink(msg);
    if (msg.t === S2C.RELAY_EVENT && msg.ev === 'start') {
      buf.matchId = typeof msg.matchId === 'string' ? msg.matchId : null;
      buf.msgs = [];
    }
    // Over the cap, player input is dropped first: it is stale by the time the frame loads.
    if (buf.msgs.length >= BUFFER_MAX && msg.t === S2C.RELAY_IN) return;
    if (buf.msgs.length >= BUFFER_MAX * 2) return;
    buf.msgs.push(msg);
  };
  net.on(S2C.RELAY_EVENT, onMsg);
  net.on(S2C.RELAY_IN, onMsg);
  relayBuffers.set(net, buf);
}

/** Hands the held messages for `matchId` to `sink`, then sends it new ones. Returns a detach function. */
function takeRelays(net, matchId, sink) {
  const buf = relayBuffers.get(net);
  if (!buf) {
    // Not installed in time: listen from now on (the runner may have missed `start`).
    const offs = [net.on(S2C.RELAY_EVENT, sink), net.on(S2C.RELAY_IN, sink)];
    return () => offs.forEach((off) => off());
  }
  const held = buf.matchId === matchId ? buf.msgs : [];
  buf.msgs = [];
  buf.sink = sink;
  for (const msg of held) sink(msg);
  return () => {
    if (buf.sink === sink) buf.sink = null;
  };
}

/**
 * Mounts a game frame into `container`.
 * @param {object} o
 * @param {import('./net.js').Net} o.net
 * @param {object} o.store                      client/js/state.js's store
 * @param {'inspect'|'player'|'host'} o.role
 * @param {string} o.src                        the game's gh: ref
 * @param {HTMLElement} o.container
 * @param {object} [o.overlay]  { onKey(type, code), openMenu, openTeamPicker, showScorebar(show),
 *   showHint(show), isBlocking(), onUi(fn) (fn gets 'block' | 'resume'; returns an unsubscribe),
 *   onLock(locked), onMounted({ teamPicker }), onError(text), onStalled(), onMeta(meta, kitVersion) }.
 *   Every member is optional.
 * @param {string} [o.title]                    the iframe's accessible name
 * @returns {{ destroy(): void, matchEnded(result): boolean, exitLock(): void, readonly iframe: HTMLIFrameElement }}
 */
export function mountGameFrame({ net, store, role, src, container, overlay = {}, title = '' }) {
  if (!ROLES.has(role)) throw new TypeError(`unknown frame role "${role}"`);
  const iframe = document.createElement('iframe');
  iframe.className = 'game-frame';
  iframe.setAttribute('sandbox', 'allow-scripts allow-pointer-lock');
  iframe.setAttribute('allow', 'fullscreen; autoplay; gamepad');
  iframe.setAttribute('referrerpolicy', 'no-referrer');
  if (title) iframe.title = title;
  iframe.src = `/frame/?src=${encodeURIComponent(src)}&parent=${encodeURIComponent(location.origin)}`;

  const cleanups = [];
  const queue = []; // messages for the frame, held until it has its `init`
  let gotReady = false;
  let inited = false;
  let destroyed = false;
  let handlesMatchEnd = false;
  let loads = 0;
  let readyTimer = 0;
  let toastBudget = 5;
  const toastRefill = setInterval(() => { toastBudget = Math.min(5, toastBudget + 1); }, 1000);
  cleanups.push(() => clearInterval(toastRefill));

  function postNow(kind, fields) {
    try {
      // An opaque origin cannot be named as a target, so '*' it is. Nothing secret is sent.
      iframe.contentWindow?.postMessage({ ...fields, fs: 1, kind }, '*');
    } catch (err) {
      console.error(`could not send "${kind}" to the game frame`, err);
    }
  }

  function post(kind, fields = {}) {
    if (destroyed) return;
    if (inited) postNow(kind, fields);
    else queue.push([kind, fields]);
  }

  function sendInit() {
    postNow('init', {
      role,
      src,
      me: store.me ?? null,
      room: role === 'inspect' ? null : store.room ?? null,
      chat: [],
      serverOffset: net.clockOffset ?? 0,
      rtt: net.rtt ?? 0,
    });
    inited = true;
    if (role !== 'inspect') postNow('ui', { blocking: Boolean(overlay.isBlocking?.()) });
    for (const [kind, fields] of queue.splice(0)) postNow(kind, fields);
  }

  // ---- the frame left the page ----

  function navigatedAway() {
    if (destroyed) return;
    const wasHost = role === 'host';
    destroy();
    // The host's frame ran the game for everyone: end the match, or it hangs for them.
    if (wasHost) net.send(C2S.RELAY, { msgs: [{ k: 'ctx', op: 'endMatch', args: [{ text: COPY.gameLeftFriendslop, error: true }, {}] }] });
    overlay.onError?.(COPY.gameLeftFriendslop);
  }

  iframe.addEventListener('load', () => {
    loads += 1;
    // The frame page loads once. A second load means it went somewhere else.
    if (loads > 1) return navigatedAway();
    // A refused page (bad or blocked source) shows its own text and never says ready.
    readyTimer = setTimeout(() => {
      if (!gotReady && !destroyed) overlay.onStalled?.();
    }, READY_WAIT_MS);
  });
  cleanups.push(() => clearTimeout(readyTimer));

  // ---- frame to page ----

  function onFrameMessage(msg) {
    switch (msg.kind) {
      case 'ready':
        if (gotReady) return;
        gotReady = true;
        sendInit();
        return;
      case 'meta':
        if (role !== 'inspect' || !isPlain(msg.meta) || jsonSize(msg.meta) > META_MAX) return;
        overlay.onMeta?.(msg.meta, typeof msg.kitVersion === 'number' ? msg.kitVersion : null);
        return;
      case 'error':
        if (typeof msg.text === 'string') overlay.onError?.(cut(msg.text, TEXT_MAX));
        return;
      case 'mounted':
        if (role === 'inspect') return;
        // Focusing the frame before its page loaded does not reach the page, so focus it now.
        if (!overlay.isBlocking?.()) focus();
        overlay.onMounted?.({ teamPicker: msg.teamPicker !== false });
        return;
      case 'send':
        if (role === 'inspect' || typeof msg.type !== 'string' || msg.type.length > TYPE_MAX) return;
        if (jsonSize(msg.data) > LIMITS.MAX_MESSAGE_BYTES - 256) return;
        net.sendGame(msg.type, msg.data);
        return;
      case 'relay':
        // Only the host's frame runs the game; anything else claiming to is ignored.
        if (role !== 'host' || !Array.isArray(msg.msgs) || msg.msgs.length > LIMITS.MAX_RELAY_MSGS) return;
        if (jsonSize(msg.msgs) > LIMITS.MAX_RELAY_BYTES - 256) return;
        net.send(C2S.RELAY, { msgs: msg.msgs });
        return;
      case 'pickTeam':
        if (role !== 'inspect' && typeof msg.team === 'string' && msg.team.length <= TYPE_MAX) net.send(C2S.TEAM, { team: msg.team });
        return;
      case 'ui':
        if (role === 'inspect' || !UI_ACTIONS.has(msg.action)) return;
        if (msg.action === 'showScorebar' || msg.action === 'showHint') overlay[msg.action]?.(Boolean(msg.show));
        else overlay[msg.action]?.();
        return;
      case 'toast': {
        if (typeof msg.text !== 'string' || toastBudget <= 0) return;
        toastBudget -= 1;
        const kind = TOAST_KINDS.has(msg.toastKind) ? msg.toastKind : 'info';
        const ms = typeof msg.ms === 'number' && Number.isFinite(msg.ms) ? Math.min(15_000, Math.max(500, msg.ms)) : undefined;
        toast(cut(msg.text, TEXT_MAX), kind, ms);
        return;
      }
      case 'handlesMatchEnd':
        handlesMatchEnd = msg.handles === true;
        return;
      case 'key':
        if ((msg.type === 'down' || msg.type === 'up') && KEYS.has(msg.code)) overlay.onKey?.(msg.type, msg.code);
        return;
      case 'lock':
        overlay.onLock?.(msg.locked === true);
        return;
      default:
    }
  }

  const onMessage = (e) => {
    if (destroyed || e.source !== iframe.contentWindow || !iframe.contentWindow) return;
    const msg = e.data;
    if (!isPlain(msg) || msg.fs !== 1 || typeof msg.kind !== 'string') return;
    onFrameMessage(msg);
  };
  window.addEventListener('message', onMessage);
  cleanups.push(() => window.removeEventListener('message', onMessage));

  // ---- page to frame ----

  if (role !== 'inspect') {
    cleanups.push(store.on('room', () => {
      if (store.room) post('room', { room: store.room });
    }));
    cleanups.push(net.on('game', (type, data) => post('game', { type, data })));
    const clock = setInterval(() => post('clock', { serverOffset: net.clockOffset ?? 0, rtt: net.rtt ?? 0 }), CLOCK_MS);
    cleanups.push(() => clearInterval(clock));
    const offUi = overlay.onUi?.((event) => {
      post('ui', { blocking: Boolean(overlay.isBlocking?.()), event });
      // Closing chat or a menu leaves focus on the page: give it back to the game.
      if (event === 'resume') focus();
    });
    if (typeof offUi === 'function') cleanups.push(offUi);
  }
  if (role === 'host') {
    // relay:event and relay:in go to the host's frame only.
    cleanups.push(takeRelays(net, store.room?.match?.matchId ?? null, (msg) => post('server', { msg })));
  }

  function focus() {
    if (destroyed) return;
    iframe.focus();
    // When the iframe element already has focus but its page does not, only this reaches the page.
    try {
      iframe.contentWindow?.focus();
    } catch {
      // nothing more to try
    }
  }

  container.append(iframe);

  function destroy() {
    if (destroyed) return;
    if (inited) postNow('destroy', {});
    destroyed = true;
    queue.length = 0;
    for (const off of cleanups.splice(0)) off();
    // Removing the frame ends its document and its worker, whatever the game does with `destroy`.
    iframe.remove();
  }

  return {
    get iframe() { return iframe; },
    destroy,
    /** Tells the game the match ended. Returns true if the game shows its own ending. */
    matchEnded(result) {
      post('matchEnd', { result });
      return !destroyed && handlesMatchEnd;
    },
    exitLock() {
      post('exitLock');
    },
    focus,
  };
}
