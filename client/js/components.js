// Reusable UI pieces shared by the lobby and the in-match overlay.

import { h, replace } from './dom.js';
import { store } from './state.js';
import { C2S } from '/shared/protocol.js';

function playerBadges(p, room) {
  return [
    p.id === room.hostId ? h('span.badge.host', 'HOST') : null,
    p.bot ? h('span.badge', 'BOT') : null,
    !p.connected ? h('span.badge.off', 'offline') : null,
    room.phase === 'playing' && p.connected && !p.inMatch ? h('span.badge', 'loading') : null,
  ];
}

/** Can the local player pick `teamId` right now? (Mirrors the server's team-switch lock.) */
export function canPickTeam(teamId) {
  const locked = store.myPlayer?.lockedTeam;
  return !locked || locked === teamId;
}

/** "Spectators: a, b" line, or null when nobody is spectating. */
export function spectatorLine(net, { kick = false } = {}) {
  const room = store.room;
  const specs = room.players.filter((p) => p.spectating);
  if (!specs.length) return null;
  return h('div.small.muted.row.wrap', h('span', '👁 Spectating:'), specs.map((p) => h('span', { style: { fontWeight: p.id === store.me ? 800 : 400 } }, p.name,
    p.id === room.hostId ? ' (host)' : '',
    kick && store.isHost && p.id !== store.me ? kickButton(net, p) : null)));
}

/**
 * Team columns: who's on which team plus team scores. Clicking a column picks that team.
 * Pass `onPick` to be notified after a pick (e.g. close the modal).
 */
export function teamColumns(net, { onPick, kick = false } = {}) {
  const room = store.room;
  const teams = room.game.teams;
  const me = store.me;

  if (!teams) {
    return h('div.stack',
      h('ul.plist', room.players.filter((p) => !p.spectating).map((p) => h(`li${p.id === me ? '.me' : ''}`,
        h('span.pname', p.name), playerBadges(p, room),
        kick && store.isHost && p.id !== me ? kickButton(net, p) : null))),
      spectatorLine(net, { kick }));
  }

  return h('div.stack', h('div.teams', teams.map((t) => {
    const members = room.players.filter((p) => p.team === t.id && !p.spectating);
    const mine = store.myPlayer?.team === t.id && !store.myPlayer?.spectating;
    const canPick = canPickTeam(t.id);
    const pick = () => {
      if (!canPick) return;
      net.send(C2S.TEAM, { team: t.id });
      onPick?.(t.id);
    };
    return h(`div.team${mine ? '.mine' : ''}${canPick ? '' : '.locked'}`, { style: { '--team': t.color }, onclick: pick, title: canPick ? `Join ${t.name}` : 'Team switching is off for this match' },
      h('div.team-head',
        h('span.name', t.name),
        h('span.muted.small', `${members.length}`),
        h('span.score', String(room.teamScores[t.id] ?? 0))),
      h('ul', members.length === 0 ? h('li.muted.small', 'Nobody yet') : members.map((p) => h(`li${p.id === me ? '.me' : ''}`,
        h('span.pname', p.name), playerBadges(p, room),
        kick && store.isHost && p.id !== me ? kickButton(net, p) : null))));
  })), spectatorLine(net, { kick }));
}

function kickButton(net, p) {
  return h('button.btn.tiny.danger', {
    title: p.bot ? `Remove ${p.name}` : `Kick ${p.name}`,
    onclick: (e) => {
      e.stopPropagation();
      if (p.bot) net.send(C2S.BOTS, { remove: p.id }); // no confirm needed for bots
      else if (confirm(`Kick ${p.name}?`)) net.send(C2S.KICK, { playerId: p.id });
    },
  }, p.bot ? 'remove' : 'kick');
}

/** Score table using the game's `scoreboard` columns (stat keys). */
export function scoreboardTable() {
  const room = store.room;
  const cols = room.game.scoreboard;
  const teams = room.game.teams;
  const sortKey = cols[0]?.key;
  // Spectators who never played have nothing to show; anyone with stats this match stays listed.
  const rows = room.players.filter((p) => !p.spectating || Object.keys(p.stats).length)
    .sort((a, b) => (b.stats[sortKey] ?? 0) - (a.stats[sortKey] ?? 0));
  const head = h('tr', h('th', 'Player'), teams ? h('th', 'Team') : null, cols.map((c) => h('th.num', c.label)), h('th.num', 'Ping'));
  const body = rows.map((p) => {
    const t = store.team(p.team);
    return h(`tr${p.id === store.me ? '.me' : ''}`,
      h('td', h('span', { style: { color: t?.color } }, p.name), p.connected ? '' : h('span.badge.off', 'offline')),
      teams ? h('td', { style: { color: t?.color } }, p.spectating ? 'spectating' : t?.name ?? '-') : null,
      cols.map((c) => h('td.num', String(p.stats[c.key] ?? 0))),
      h('td.num.muted', p.connected ? `${p.ping}` : '-'));
  });
  return h('div.scoreboard', h('table', h('thead', head), h('tbody', body)));
}

export function chatLine(m) {
  if (m.system) return h('div.sys', m.text);
  return h('div', { style: { '--who': store.teamColor(m.team) } }, h('b', `${m.name}: `), m.text);
}

/** Lobby chat panel (always visible). */
export function chatPanel(net) {
  const log = h('div.chat-log');
  const input = h('input', { type: 'text', maxLength: 200, placeholder: 'Say something…', autocomplete: 'off' });
  const render = () => {
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 30;
    replace(log, store.chat.map(chatLine));
    if (atBottom) log.scrollTop = log.scrollHeight;
  };
  render();
  const off = store.on('chat', render);
  const el = h('div.panel.chat',
    h('div.muted.small', 'Chat'),
    log,
    h('form', {
      onsubmit: (e) => {
        e.preventDefault();
        if (input.value.trim()) net.send(C2S.CHAT, { text: input.value });
        input.value = '';
      },
    }, input, h('button.btn', 'Send')));
  setTimeout(() => { log.scrollTop = log.scrollHeight; });
  return { el, destroy: off };
}

export function resultBox(result) {
  if (!result) return null;
  const room = store.room;
  const winTeam = room.game.teams?.find((t) => t.id === result.winner);
  const winPlayer = !winTeam && result.winner ? result.stats?.[result.winner]?.name : null;
  return h(`div.result${result.error ? '.error' : ''}`,
    h('div', h('b', 'Last match: '), result.text),
    winTeam ? h('div', { style: { color: winTeam.color, fontWeight: 800 } }, `${winTeam.name} wins!`) : null,
    winPlayer ? h('div', { style: { fontWeight: 800 } }, `${winPlayer} wins!`) : null,
    room.game.teams ? h('div.small.muted', room.game.teams.map((t) => `${t.name} ${result.teamScores?.[t.id] ?? 0}`).join('  ·  ')) : null);
}
