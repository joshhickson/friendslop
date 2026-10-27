// Runs inside the sandboxed game frame (server/frame.js), with an opaque origin. It loads a game
// from GitHub (through the CDN, pinned to one commit) and talks to the friendslop page that made
// the frame only by postMessage.
//
// Every message, both ways, is { fs: 1, kind, ...fields }. The frame accepts messages only from
// window.parent with event.origin equal to the page's `parent` query value, and posts only to
// that origin. The parent must check event.source, since the frame's origin reads "null".
//
// Frame to parent:
//   ready                       boot is listening: send `init`
//   meta { meta, kitVersion }   inspect role: describeGame(def, { hasBot }) and the fork's KIT_VERSION
//   error { text }              the game could not be loaded (player-facing text from COPY)
//   mounted { teamPicker }      player and host roles: the game's client mounted. teamPicker is
//                               false when the game asked for no team picker on load
//   send { type, data }         api.send: a game message for the server (net.sendGame)
//   relay { msgs }              host role: the runner's relay batch (net.send(C2S.RELAY, { msgs }))
//   pickTeam { team }           api.pickTeam
//   ui { action, show? }        action: openMenu | openTeamPicker | showScorebar | showHint
//   toast { text, toastKind, ms? }  api.toast (toastKind, because `kind` names the message)
//   handlesMatchEnd { handles } whether the game has an onMatchEnd handler, sent when that changes
//   key { type, code }          type 'down' | 'up'; code Tab, Enter, NumpadEnter or Escape, pressed
//                               while the frame has focus (key repeats are not sent)
//   lock { locked }             the frame document's pointerlockchange
//
// Parent to frame:
//   init { role, src, me, room, chat, serverOffset, rtt? }  role 'inspect' | 'player' | 'host'; once
//   room { room }               a new room snapshot
//   game { type, data }         a game message from the server
//   server { msg }              host role: the server's relay:event and relay:in messages, unchanged
//   ui { blocking, event? }     the overlay's state; event 'block' | 'resume'
//   matchEnd { result }         the match ended (calls the game's onMatchEnd handlers)
//   clock { serverOffset, rtt } fresher clock numbers
//   exitLock                    release pointer lock
//   destroy                     tear the game down

import { S2C } from '../../shared/protocol.js';
import { COPY } from '../../shared/copy.js';
import { describeGame } from './runner-core.js';
import { createBridge, createGameApi } from './game-api.js';

const FORWARDED_KEYS = new Set(['Tab', 'Enter', 'NumpadEnter', 'Escape']);
const ROLES = new Set(['inspect', 'player', 'host']);

const parentOrigin = new URLSearchParams(location.search).get('parent');
const frameConfig = JSON.parse(document.getElementById('frame-config').textContent);
/** The repo folder at the pinned commit, absolute (with the dev CDN the server writes it relative). */
const base = new URL(frameConfig.base, location.href).href;
/** A file in the game's folder, e.g. gameUrl('server.js'). */
const gameUrl = (file) => new URL(`${frameConfig.path}/${file}`, base).href;

const errText = (err) => (err && typeof err.message === 'string' ? err.message : String(err));

function post(kind, fields = {}) {
  try {
    window.parent.postMessage({ ...fields, fs: 1, kind }, parentOrigin);
  } catch (err) {
    console.error(`could not send "${kind}" to the page`, err);
  }
}

const bridge = createBridge(post);
let role = null;
let instance = null; // what the game's mount() returned
let worker = null; // host role: the runner
let runnerDown = false;
let torn = false;
const cleanups = [];

const fail = (text) => post('error', { text });

// ---- inspect: what the host form needs to make a room ----

async function inspect() {
  let kit;
  try {
    kit = await import(new URL('server/kit/index.js', base).href);
  } catch (err) {
    return fail(COPY.gameWontLoad(errText(err)));
  }
  const kitVersion = kit.KIT_VERSION;
  if (typeof kitVersion !== 'number' || !(kitVersion >= 1)) return fail(COPY.forkTooOld);
  let def;
  try {
    def = (await import(gameUrl('server.js'))).default;
    if (!def || typeof def.create !== 'function') throw new Error('server.js has no defineGame() default export');
  } catch (err) {
    return fail(COPY.gameWontLoad(errText(err)));
  }
  const hasBot = await fetch(gameUrl('bot.js'), { method: 'HEAD' }).then((res) => res.ok, () => false);
  let meta;
  try {
    meta = describeGame(def, { hasBot });
  } catch (err) {
    return fail(COPY.gameWontLoad(errText(err)));
  }
  post('meta', { meta, kitVersion });
}

// ---- player: the game's client, with the frame's api ----

function listen(target, type, fn, opts) {
  target.addEventListener(type, fn, opts);
  cleanups.push(() => target.removeEventListener(type, fn, opts));
}

async function play() {
  // The overlay's keys reach the page only while it has focus, so pass them on from here.
  const onKey = (type) => (e) => {
    if (!FORWARDED_KEYS.has(e.code)) return;
    if (e.code === 'Tab') e.preventDefault(); // keep focus where it is
    if (!e.repeat) post('key', { type, code: e.code });
  };
  listen(window, 'keydown', onKey('down'), true);
  listen(window, 'keyup', onKey('up'), true);
  listen(document, 'pointerlockchange', () => post('lock', { locked: Boolean(document.pointerLockElement) }));

  const api = createGameApi(bridge, { root: document.getElementById('root'), hud: document.getElementById('hud') });
  let def;
  try {
    def = (await import(gameUrl('client/index.js'))).default;
    if (!def || typeof def.mount !== 'function') throw new Error('client/index.js has no defineClientGame() default export');
  } catch (err) {
    console.error(err);
    return fail(COPY.gameWontLoad(errText(err)));
  }
  if (torn) return;
  try {
    instance = (await def.mount(api)) ?? {};
  } catch (err) {
    console.error(err);
    return fail(COPY.gameWontLoad(errText(err)));
  }
  if (torn) {
    destroyInstance();
    return;
  }
  post('mounted', { teamPicker: def.teamPicker !== false });
}

function destroyInstance() {
  try {
    instance?.destroy?.();
  } catch (err) {
    console.error('game destroy() failed', err);
  }
  instance = null;
}

// ---- host: the runner, in a worker so a background tab keeps the game ticking ----

/**
 * The worker's whole source. It runs as a blob: CLASSIC worker: a blob: module worker will not
 * start from an opaque origin, so it loads its modules with import(). Its origin is "null" and
 * import maps do not apply in it, so every URL it gets is absolute, and the game's server.js and
 * bot.js may use relative imports only. Never called on the main thread.
 */
function workerMain() {
  let runner = null;
  let queue = [];
  let stopped = false;

  async function boot({ runnerUrl, serverUrl, botUrl }) {
    try {
      const [core, game] = await Promise.all([import(runnerUrl), import(serverUrl)]);
      if (stopped) return;
      const def = game.default;
      if (!def || typeof def.create !== 'function') throw new Error('server.js has no defineGame() default export');
      runner = core.createRunner({
        def,
        transport: { send: (msg) => self.postMessage({ kind: 'relay', msgs: msg.msgs }) },
        loadBrain: async () => (await import(botUrl)).default ?? null,
      });
      const pending = queue;
      queue = null;
      for (const msg of pending) runner.receive(msg);
    } catch (err) {
      self.postMessage({ kind: 'failed', text: err && typeof err.message === 'string' ? err.message : String(err) });
    }
  }

  self.onmessage = (e) => {
    const m = e.data;
    if (!m || typeof m !== 'object') return;
    if (m.kind === 'boot') boot(m);
    else if (m.kind === 'server') {
      if (runner) runner.receive(m.msg);
      else if (queue) queue.push(m.msg);
    } else if (m.kind === 'stop') {
      stopped = true;
      runner?.stop();
      self.close();
    }
  };
}

/** The runner could not run the game: end the match for everyone, the way a crash does. */
function runnerFailed(text) {
  if (runnerDown) return;
  runnerDown = true;
  console.error('the game runner failed:', text);
  post('relay', { msgs: [{ k: 'ctx', op: 'endMatch', args: [{ text: COPY.gameCrashed(text), error: true }, {}] }] });
  worker?.terminate();
  worker = null;
}

function toRunner(msg) {
  worker?.postMessage({ kind: 'server', msg });
}

function startRunner() {
  const url = URL.createObjectURL(new Blob([`(${workerMain.toString()})();\n`], { type: 'text/javascript' }));
  try {
    worker = new Worker(url);
  } catch (err) {
    URL.revokeObjectURL(url);
    runnerFailed(errText(err));
    return;
  }
  worker.onmessage = (e) => {
    const m = e.data;
    if (m?.kind === 'relay' && Array.isArray(m.msgs)) post('relay', { msgs: m.msgs });
    else if (m?.kind === 'failed') runnerFailed(String(m.text));
  };
  worker.onerror = (e) => {
    e.preventDefault?.();
    runnerFailed(e.message || 'the game runner did not start');
  };
  worker.postMessage({
    kind: 'boot',
    runnerUrl: new URL('./runner-core.js', import.meta.url).href,
    serverUrl: gameUrl('server.js'),
    botUrl: gameUrl('bot.js'),
  });
  // The worker has read its source by now (or failed, and onerror says so).
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  if (bridge.state.room) toRunner({ t: S2C.ROOM, room: bridge.state.room });
}

// ---- messages from the page ----

function teardown() {
  if (torn) return;
  torn = true;
  destroyInstance();
  bridge.destroy();
  for (const off of cleanups.splice(0)) off();
  if (document.pointerLockElement) document.exitPointerLock();
  if (worker) {
    // The runner ends any match it is running (onEnd, bots destroyed), then closes itself.
    const w = worker;
    worker = null;
    w.postMessage({ kind: 'stop' });
    setTimeout(() => w.terminate(), 1000);
  }
}

function init(msg) {
  if (role !== null || !ROLES.has(msg.role)) return;
  role = msg.role;
  if (msg.src !== undefined && msg.src !== frameConfig.src) {
    fail(COPY.badSource);
    return;
  }
  bridge.init(msg);
  if (role === 'inspect') {
    inspect();
    return;
  }
  // The host runs the game for everyone, so its runner starts first and keeps going even if
  // the host's own view of the game fails to load.
  if (role === 'host') startRunner();
  play();
}

function handle(msg) {
  if (msg.kind === 'init') return init(msg);
  if (role === null || torn) return;
  switch (msg.kind) {
    case 'room':
      bridge.setRoom(msg.room);
      if (role === 'host' && msg.room) toRunner({ t: S2C.ROOM, room: msg.room });
      return;
    case 'game': return bridge.gameMessage(msg.type, msg.data);
    case 'server':
      if (role === 'host' && msg.msg && typeof msg.msg === 'object') toRunner(msg.msg);
      return;
    case 'ui': return bridge.setUi(msg);
    case 'matchEnd':
      bridge.matchEnded(msg.result);
      return;
    case 'clock': return bridge.setClock(msg);
    case 'exitLock':
      if (document.pointerLockElement) document.exitPointerLock();
      return;
    case 'destroy': return teardown();
    default:
  }
}

if (parentOrigin) {
  window.addEventListener('message', (e) => {
    if (e.source !== window.parent || e.origin !== parentOrigin) return;
    const msg = e.data;
    if (!msg || typeof msg !== 'object' || msg.fs !== 1 || typeof msg.kind !== 'string') return;
    handle(msg);
  });
  post('ready');
} else {
  console.error('the game frame needs a parent origin');
}
