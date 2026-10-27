// Lobby: room code, teams + scores, game settings (host edits), start button (host only), chat.

import { h, replace, toast } from '../dom.js';
import { store } from '../state.js';
import { teamColumns, chatPanel, resultBox } from '../components.js';
import { C2S } from '/shared/protocol.js';

function settingInput(net, s, value, editable, send = (v) => net.send(C2S.CONFIG, { settings: { [s.key]: v } })) {
  let input;
  if (s.type === 'boolean') {
    input = h('input', { type: 'checkbox', checked: Boolean(value), disabled: !editable, onchange: (e) => send(e.target.checked) });
    return h('label.field', h('span', s.label), h('span.row', input, h('span.small', value ? 'On' : 'Off')));
  }
  if (s.type === 'number') {
    input = h('input', { type: 'number', value: String(value), min: s.min, max: s.max, step: s.step, disabled: !editable, onchange: (e) => send(Number(e.target.value)) });
  } else {
    input = h('select', { disabled: !editable, onchange: (e) => send(s.options.find((o) => String(o.value) === e.target.value)?.value) },
      s.options.map((o) => h('option', { value: String(o.value), selected: o.value === value }, o.label)));
  }
  return h('label.field', h('span', s.label, s.unit ? h('span.muted', ` (${s.unit})`) : ''), input);
}

// The host's choices survive lobby re-renders.
const botPrefs = { count: 1, team: 'auto', difficulty: 'normal' };

function botPanel(net, room) {
  const free = room.maxPlayers - room.players.filter((p) => !p.spectating).length;
  const botCount = room.players.filter((p) => p.bot).length;
  const count = h('input', {
    type: 'number', min: 1, max: Math.max(1, free), value: String(Math.min(botPrefs.count, Math.max(1, free))), style: { width: '70px' },
    onchange: (e) => { botPrefs.count = Math.max(1, Math.floor(Number(e.target.value) || 1)); },
  });
  const team = room.game.teams ? h('select', { onchange: (e) => { botPrefs.team = e.target.value; } },
    h('option', { value: 'auto', selected: botPrefs.team === 'auto' }, 'Balance teams'),
    room.game.teams.map((t) => h('option', { value: t.id, selected: botPrefs.team === t.id }, t.name))) : null;
  const difficulty = h('select', { onchange: (e) => { botPrefs.difficulty = e.target.value; } },
    ['easy', 'normal', 'hard'].map((d) => h('option', { value: d, selected: botPrefs.difficulty === d }, d[0].toUpperCase() + d.slice(1))));
  return h('div.panel.stack',
    h('div.row', h('b', 'Bots'), h('span.muted.small', `${botCount} in room · ${free} free slot${free === 1 ? '' : 's'}`)),
    h('div.row.wrap',
      h('label.field', 'How many', count),
      team ? h('label.field', 'Team', team) : null,
      h('label.field', 'Difficulty', difficulty),
      h('button.btn', {
        disabled: free <= 0,
        style: { alignSelf: 'flex-end' },
        onclick: () => net.send(C2S.BOTS, { add: Math.min(botPrefs.count, free), team: botPrefs.team, difficulty: botPrefs.difficulty }),
      }, 'Add bots'),
      botCount ? h('button.btn.danger', { style: { alignSelf: 'flex-end' }, onclick: () => net.send(C2S.BOTS, { remove: 'all' }) }, 'Remove all bots') : null));
}

export function lobbyScreen(net) {
  const left = h('div.stack');
  const head = h('div.lobby-head');
  const chat = chatPanel(net);
  const right = h('div.stack', chat.el);
  const el = h('div.screen', h('div.lobby', head, left, right));

  function copyInvite() {
    const url = `${location.origin}/?room=${store.room.id}`;
    navigator.clipboard?.writeText(url).then(
      () => toast('Invite link copied (they still need the password).', 'ok'),
      () => toast(url),
    );
  }

  function render() {
    const room = store.room;
    if (!room) return;
    const isHost = store.isHost;
    const games = store.hello?.games ?? [];
    const enough = room.autoFill || room.players.filter((p) => p.connected && !p.spectating).length >= room.game.minPlayers;
    const meSpectating = Boolean(store.myPlayer?.spectating);

    replace(head,
      h('div', h('div.muted.small', 'Room code'), h('div.room-code', room.id)),
      h('button.btn', { onclick: copyInvite }, 'Copy invite link'),
      room.hasPassword ? h('span.badge', '🔒 password') : h('span.badge.off', 'no password'),
      h('div.grow'),
      h('button.btn.danger', { onclick: () => net.send(C2S.LEAVE) }, 'Leave'));

    const gameRow = isHost && games.length > 1 && !room.game.source
      ? h('select', { onchange: (e) => net.send(C2S.CONFIG, { game: e.target.value }) },
        games.map((g) => h('option', { value: g.id, selected: g.id === room.game.id }, g.name)))
      : h('b', room.game.name);

    replace(left,
      resultBox(room.lastResult),
      h('div.panel.stack',
        h('div.row', h('span.muted', 'Game:'), gameRow, h('div.grow'),
          h('span.muted.small', `${room.players.filter((p) => !p.spectating).length}/${room.maxPlayers} players`)),
        room.game.description ? h('div.muted.small', room.game.description) : null,
        room.game.teams ? h('div.muted.small', 'Click a team to join it.') : null,
        teamColumns(net, { kick: true }),
        h('div.row.wrap',
          room.game.teams || meSpectating ? h('button.btn', { onclick: () => net.send(C2S.TEAM, { team: 'auto' }) }, meSpectating ? 'Join the game' : 'Auto-balance me') : null,
          meSpectating
            ? h('span.muted.small', "You're spectating: you'll watch the match without playing.")
            : h('button.btn', { onclick: () => net.send(C2S.TEAM, { team: 'spectate' }) }, '👁 Spectate instead'))),
      isHost && room.botsSupported ? botPanel(net, room) : null,
      room.game.settings.length || room.game.teams ? h('div.panel.stack',
        h('div.row', h('b', 'Settings'), isHost ? null : h('span.muted.small', '(host only)')),
        h('div.settings',
          room.game.settings.map((s) => settingInput(net, s, room.settings[s.key], isHost && room.phase === 'lobby')),
          // Framework option, available for every team game.
          room.game.teams ? settingInput(net, { key: 'teamSwitch', label: 'Team switching mid-match', type: 'boolean' }, room.options.teamSwitch,
            isHost && room.phase === 'lobby', (v) => net.send(C2S.CONFIG, { options: { teamSwitch: v } })) : null)) : null,
      h('div.panel.row.wrap',
        room.phase !== 'lobby'
          ? h('div.muted', 'The last match is wrapping up…')
          : isHost
            ? h('button.btn.primary.big', { disabled: !enough, onclick: () => net.send(C2S.START) }, 'Start match')
            : h('div.muted', 'Waiting for the host to start the match…'),
        room.autoFill && room.phase === 'lobby' ? h('span.muted.small', `Bots will fill both teams to ${room.autoFill} when the match starts.`) : null,
        !enough ? h('span.muted.small', `Needs at least ${room.game.minPlayers} player${room.game.minPlayers === 1 ? '' : 's'} (spectators don't count).`) : null));
  }

  render();
  const off = store.on('room', render);
  return {
    el,
    destroy() {
      off();
      chat.destroy();
    },
  };
}
