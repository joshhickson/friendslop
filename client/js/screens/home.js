// Home screen: pick a name, then create a room or join one with code + password.

import { h } from '../dom.js';
import { store, savedName } from '../state.js';
import { C2S, LIMITS } from '/shared/protocol.js';

export function homeScreen(net, { prefillCode = '', preferGame = '' } = {}) {
  let tab = prefillCode ? 'join' : 'create';

  const name = h('input', { type: 'text', maxLength: LIMITS.NAME_MAX, placeholder: 'Your name', value: savedName.get(), autocomplete: 'off' });
  const code = h('input.code', { type: 'text', maxLength: LIMITS.ROOM_ID_LEN, placeholder: 'ABC123', value: prefillCode, autocomplete: 'off' });
  const joinPw = h('input', { type: 'password', maxLength: LIMITS.PASSWORD_MAX, placeholder: 'Room password', autocomplete: 'off' });
  const createPw = h('input', { type: 'password', maxLength: LIMITS.PASSWORD_MAX, placeholder: 'Leave empty for no password', autocomplete: 'new-password' });
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
    body.replaceChildren(tab === 'create' && games.length === 0
      ? h('p.subtitle', 'No games yet. Make one with npm run new-game -- my-game, then restart the server.')
      : tab === 'create'
      ? h('form.stack', { onsubmit: create },
        h('label.field', 'Game', game),
        h('label.field', 'Password (optional)', createPw),
        h('button.btn.primary.big', { type: 'submit' }, 'Create room'))
      : h('form.stack', { onsubmit: join },
        h('label.field', 'Room code', code),
        h('label.field', 'Password', joinPw),
        h('button.btn.primary.big', { type: 'submit' }, 'Join room')));
  }
  render();

  const el = h('div.screen', h('div.home',
    h('h1.title', 'friend', h('span', 'slop')),
    h('p.subtitle', 'Make a room, share the code + password, play.'),
    h('div.panel.stack',
      h('label.field', 'Name', name),
      h('div.spacer'),
      tabs,
      body)));

  setTimeout(() => (name.value ? (tab === 'join' ? code : name) : name).focus());
  return { el, destroy() {} };
}
