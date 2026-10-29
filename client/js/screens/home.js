// Home screen: pick a name, then create a room or join one with code + password.

import { h } from '../dom.js';
import { store, savedName } from '../state.js';
import { C2S, S2C, LIMITS, jsonBytes } from '/shared/protocol.js';
import { COPY } from '/shared/copy.js';
import { parseGithubUrl, formatRef, parseRef, repoKey } from '/shared/gameref.js';
import { resolveCommit, inspectGame } from '../github.js';
import { confirmFirstLook } from '../unreviewed.js';

const LOCAL = `gh:local/friendslop@${'0'.repeat(40)}/`;
const STARTER = `${LOCAL}templates/starter`;
// With the dev CDN, a folder of this checkout (games/cp) can be hosted the way a GitHub link is.
const LOCAL_FOLDER = /^(games|templates)\/[a-z0-9_-]+\/?$/;
// The Control Points demo, hosted like any other link. With the dev CDN it comes from this checkout.
const DEMO_LINK = 'https://github.com/joshhickson/friendslop/tree/main/games/cp';
const DEMO_LOCAL = 'games/cp';
const DEFAULT_API = 'https://api.github.com';

export function homeScreen(net, { prefillCode = '', preferGame = '', prefillHost = '' } = {}) {
  let tab = prefillCode && !prefillHost ? 'join' : 'create';

  const name = h('input', { type: 'text', maxLength: LIMITS.NAME_MAX, placeholder: 'Your name', value: savedName.get(), autocomplete: 'off' });
  const code = h('input.code', { type: 'text', maxLength: LIMITS.ROOM_ID_LEN, placeholder: 'ABC123', value: prefillCode, autocomplete: 'off' });
  const joinPw = h('input', { type: 'password', maxLength: LIMITS.PASSWORD_MAX, placeholder: 'Room password', autocomplete: 'off' });
  const createPw = h('input', { type: 'password', maxLength: LIMITS.PASSWORD_MAX, placeholder: COPY.noPasswordPlaceholder, autocomplete: 'new-password' });
  const games = store.hello?.games ?? [];
  const initialGame = games.some((g) => g.id === preferGame) ? preferGame : store.hello?.defaultGame;
  const game = h('select', games.map((g) => h('option', { value: g.id, selected: g.id === initialGame }, g.name)));

  const body = h('div.stack');
  const tabs = h('div.tabs');

  function getName() {
    const n = name.value.trim();
    if (!n) {
      name.focus();
      name.style.borderColor = 'var(--danger)';
      return null;
    }
    savedName.set(n);
    return n;
  }

  function create(e) {
    e?.preventDefault();
    const n = getName();
    if (!n) return;
    net.send(C2S.CREATE, { name: n, game: game.value, password: createPw.value });
  }

  // ---- host a game from a pasted GitHub link ----

  const remote = store.hello?.remote ?? {};
  const hostLink = h('input', { type: 'text', maxLength: 300, placeholder: COPY.hostPlaceholder, value: prefillHost, autocomplete: 'off', spellcheck: false });
  const hostPw = h('input', { type: 'password', maxLength: LIMITS.PASSWORD_MAX, placeholder: COPY.noPasswordPlaceholder, autocomplete: 'new-password' });
  const hostError = h('p.form-error', { role: 'alert' });
  const hostNote = h('p.muted.small', { role: 'status' });
  const hostButton = h('button.btn.primary', { type: 'submit' }, COPY.hostButton);
  const starterButton = remote.dev ? h('button.btn', { type: 'button', onclick: () => hostFrom(async () => ({ src: STARTER })) }, COPY.hostStarter) : null;
  // The demo fills in its link first, so the box shows what is being hosted.
  const demoButton = h('button.btn', { type: 'button', onclick: () => {
    if (busy) return;
    hostLink.value = remote.dev ? DEMO_LOCAL : DEMO_LINK;
    hostFrom(findLink);
  } }, COPY.hostDemo);
  const inspectBox = h('div.inspect-host');
  const abort = new AbortController();
  let busy = false;
  let sent = false;
  let gone = false;

  function setBusy(on) {
    busy = on;
    hostLink.disabled = on;
    hostButton.disabled = on;
    if (starterButton) starterButton.disabled = on;
    demoButton.disabled = on;
    hostButton.textContent = on ? COPY.hostChecking : COPY.hostButton;
    hostNote.textContent = '';
  }

  /** The game is taking its time to load: say so, so nobody gives up on a working link. */
  function stillLoading() {
    if (gone || !busy) return;
    hostButton.textContent = COPY.hostStillLoading;
    hostNote.textContent = COPY.hostSlowHint;
  }

  /** From the pasted link to the game's pinned ref: { src } or { text } for the field's error. */
  async function findLink() {
    const typed = hostLink.value.trim();
    if (remote.dev && LOCAL_FOLDER.test(typed)) {
      const src = LOCAL + typed.replace(/\/$/, '');
      return parseRef(src) ? { src } : { text: COPY.badSource };
    }
    const link = parseGithubUrl(hostLink.value);
    if (link.error) return { text: COPY.badLink(link.error) };
    const found = await resolveCommit(link, { api: remote.githubApi || DEFAULT_API });
    if (found.error) return { text: COPY.badLink(found.error) };
    const src = formatRef({ user: link.user, repo: link.repo, commit: found.commit, path: link.path });
    // A folder name the server would refuse (capitals, dots) fails here with a reason, not later.
    return parseRef(src) ? { src } : { text: COPY.badSource };
  }

  /** `find` gives { src } or { text }. Then: first look, the hidden check of the game, the room. */
  async function hostFrom(find) {
    if (busy) return;
    const n = getName();
    if (!n) return;
    hostError.textContent = '';
    setBusy(true);
    const fail = (text) => {
      if (gone) return;
      hostError.textContent = text;
      setBusy(false);
    };
    try {
      const found = await find();
      if (gone) return;
      if (!found.src) return fail(found.text);
      // The game is not run, even to look at it, until this browser has said yes to its repo.
      const yes = await confirmFirstLook(repoKey(found.src), { signal: abort.signal, noLabel: COPY.firstLookNotNow });
      if (gone) return;
      if (!yes) return setBusy(false);
      const seen = await inspectGame(found.src, { container: inspectBox, net, store, signal: abort.signal, onSlow: stillLoading });
      if (gone) return;
      if (seen.error) return fail(seen.error);
      const create = { t: C2S.CREATE, name: n, password: hostPw.value, source: found.src, def: seen.meta };
      // The server closes the socket on a message over its limit, so say why here instead.
      if (jsonBytes(create, LIMITS.MAX_MESSAGE_BYTES) > LIMITS.MAX_MESSAGE_BYTES) return fail(COPY.gameTooBigToHost);
      sent = true;
      net.send(C2S.CREATE, { name: n, password: hostPw.value, source: found.src, def: seen.meta });
    } catch (err) {
      console.error('hosting from a link failed', err);
      fail(COPY.badLink('network'));
    }
  }

  // The server refused the room (a blocked game, a description it did not like): try again.
  const offError = net.on(S2C.ERROR, () => {
    if (busy && sent) {
      sent = false;
      setBusy(false);
    }
  });

  function hostForm() {
    return h('form.stack.host-form', { onsubmit: (e) => { e.preventDefault(); hostFrom(findLink); } },
      h('h2', COPY.hostTitle),
      h('p.muted.small', COPY.hostHint),
      h('label.field', COPY.hostLinkLabel, hostLink),
      h('label.field', COPY.passwordLabel, hostPw),
      hostError,
      hostNote,
      h('div.row.wrap', hostButton, demoButton, starterButton));
  }

  function join(e) {
    e?.preventDefault();
    const n = getName();
    if (!n) return;
    if (code.value.trim().length !== LIMITS.ROOM_ID_LEN) {
      code.focus();
      return;
    }
    net.send(C2S.JOIN, { name: n, roomId: code.value.trim().toUpperCase(), password: joinPw.value });
  }

  function render() {
    tabs.replaceChildren(
      h(`button.btn${tab === 'create' ? '.active' : ''}`, { type: 'button', onclick: () => { tab = 'create'; render(); } }, 'Create room'),
      h(`button.btn${tab === 'join' ? '.active' : ''}`, { type: 'button', onclick: () => { tab = 'join'; render(); } }, 'Join room'),
    );
    body.replaceChildren(...(tab === 'create'
      ? [
        games.length === 0
          ? h('p.subtitle', COPY.noGamesYet)
          : h('form.stack', { onsubmit: create },
            h('label.field', 'Game', game),
            h('label.field', COPY.passwordLabel, createPw),
            h('button.btn.primary.big', { type: 'submit' }, 'Create room')),
        hostForm(),
      ]
      : [h('form.stack', { onsubmit: join },
        h('label.field', 'Room code', code),
        h('label.field', 'Password', joinPw),
        h('button.btn.primary.big', { type: 'submit' }, 'Join room'))]));
  }
  render();

  const el = h('div.screen', h('div.home',
    h('h1.title', 'friend', h('span', 'slop')),
    h('p.subtitle', 'Make a room, share the code + password, play.'),
    h('div.panel.stack',
      h('label.field', 'Name', name),
      h('div.spacer'),
      tabs,
      body),
    h('p.muted.small.home-foot', h('a', { href: 'https://friendslop.us/privacy/', target: '_blank', rel: 'noopener' }, 'Privacy'))),
    inspectBox);

  setTimeout(() => {
    if (prefillHost) hostLink.focus();
    else (name.value ? (tab === 'join' ? code : name) : name).focus();
  });
  return {
    el,
    destroy() {
      gone = true;
      offError();
      abort.abort(); // takes down the first-look screen and the hidden frame, if they are up
    },
  };
}
