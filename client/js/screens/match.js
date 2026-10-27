// In-match screen: loads the game's client module, gives it an `api`, and draws the
// framework overlay on top: team scores, team picker, Tab scoreboard, chat, pause menu.

import { h, replace, toast } from '../dom.js';
import { store } from '../state.js';
import { Emitter } from '../net.js';
import { teamColumns, scoreboardTable, chatLine, canPickTeam } from '../components.js';
import { C2S } from '/shared/protocol.js';

const CHAT_FADE_MS = 8000;

export function matchScreen(net, app) {
  const room = store.room;
  const gameId = room.game.id;
  const root = h('div.game-root');
  const hud = h('div.game-hud');
  const overlay = h('div.overlay');
  const loading = h('div.loading', `Loading ${room.game.name}…`);
  const el = h('div', { style: { position: 'absolute', inset: 0 } }, root, hud, overlay, loading);

  const gameEvents = new Emitter();
  const matchEndHandlers = new Set();
  const uiEvents = new Emitter();
  const cleanups = [];
  let instance = null;
  let destroyed = false;
  let ready = false;
  let modal = null; // 'teams' | 'menu' | null
  let showScores = false;
  let chatOpen = false;
  let expectUnlock = false;
  let hadLock = false;
  let menuOpenedByUnlockAt = 0;

  // ---------- overlay pieces ----------
  const scorebar = h('div.scorebar');
  const modalHost = h('div');
  const scoreHost = h('div');
  const chatLines = h('div.lines');
  const chatInput = h('input', { type: 'text', maxLength: 200, placeholder: 'Enter to send, Esc to cancel', autocomplete: 'off' });
  const chatForm = h('form', {
    onsubmit: (e) => {
      e.preventDefault();
      if (chatInput.value.trim()) net.send(C2S.CHAT, { text: chatInput.value });
      closeChat();
    },
  }, chatInput);
  const chatBox = h('div.game-chat', chatLines, chatForm);
  const controls = room.game.controls ?? [];
  const hint = h('div.hint',
    controls.map(([key, what]) => h('div', h('span.kbd', key), ` ${what}`)),
    h('div', h('span.kbd', 'Tab'), ' scores  ', h('span.kbd', 'Enter'), ' chat  ', h('span.kbd', 'Esc'), ' menu'));
  overlay.append(scorebar, chatBox, hint, scoreHost, modalHost);
  let scorebarVisible = true;

  function renderScorebar() {
    const r = store.room;
    const teams = r?.game.teams;
    if (!teams || !scorebarVisible) {
      scorebar.style.display = 'none';
      return;
    }
    scorebar.style.display = '';
    const myTeam = store.myPlayer?.team;
    replace(scorebar, teams.map((t) => h(`div.ts${t.id === myTeam ? '.mine' : ''}`, { style: { '--team': t.color } },
      h('small', t.name), String(r.teamScores[t.id] ?? 0))));
  }

  function renderScores() {
    if (!showScores || modal) {
      scoreHost.replaceChildren();
      return;
    }
    replace(scoreHost, h('div.modal-bg', { style: { pointerEvents: 'none' } },
      h('div.panel.modal.stack', h('h2', room.game.name), store.room.game.teams ? teamColumns(net) : null, scoreboardTable())));
  }

  function renderChat() {
    const now = Date.now();
    replace(chatLines, store.chat.slice(-12).map((m) => {
      const line = chatLine(m);
      if (now - (m.at ?? now) > CHAT_FADE_MS) line.classList.add('old');
      return line;
    }));
    chatLines.scrollTop = chatLines.scrollHeight;
  }
  const fadeTimer = setInterval(renderChat, 1000);
  cleanups.push(() => clearInterval(fadeTimer));

  function renderModal() {
    if (modal === 'teams') {
      const me = store.myPlayer;
      const myTeam = me?.spectating ? null : store.team(me?.team);
      const locked = me?.lockedTeam;
      replace(modalHost, h('div.modal-bg', h('div.panel.modal.stack',
        h('h2', 'Pick your team'),
        h('div.muted.small', locked
          ? 'Team switching is off for this match: you can rejoin your team or keep spectating.'
          : 'Click a team to join it. You can switch later from the Esc menu.'),
        teamColumns(net, { onPick: () => closeModal(true) }),
        h('div.row.wrap',
          myTeam ? h('button.btn.primary', { style: { background: myTeam.color, borderColor: myTeam.color }, onclick: () => closeModal(true) }, `Play as ${myTeam.name}`) : null,
          h('button.btn', { onclick: () => { net.send(C2S.TEAM, { team: 'auto' }); closeModal(true); } }, locked ? 'Rejoin my team' : 'Auto-balance'),
          h('div.grow'),
          h('button.btn', { onclick: () => { net.send(C2S.TEAM, { team: 'spectate' }); closeModal(true); } }, '👁 Spectate')))));
    } else if (modal === 'menu') {
      const isHost = store.isHost;
      const me = store.myPlayer;
      const teams = store.room.game.teams;
      const canSwitch = teams && !me?.lockedTeam;
      replace(modalHost, h('div.modal-bg', h('div.panel.modal.stack',
        h('div.row', h('h2.grow', me?.spectating ? 'Spectating' : 'Paused'), h('span.muted.small', `Room ${store.room.id}`)),
        h('div.muted.small', 'The match keeps running while this menu is open.'),
        teams ? h('div.stack',
          h('b', me?.spectating ? 'Teams (click one to join the game)' : canSwitch ? 'Teams (click to switch)' : 'Teams (switching is off for this match)'),
          teamColumns(net, { onPick: () => closeModal(true), kick: true })) : teamColumns(net, { kick: true }),
        scoreboardTable(),
        h('div.row.wrap',
          h('button.btn.primary', { onclick: () => closeModal(true) }, 'Resume'),
          me?.spectating
            ? (teams ? null : h('button.btn', { onclick: () => { net.send(C2S.TEAM, { team: 'auto' }); closeModal(true); } }, 'Join the game'))
            : h('button.btn', { onclick: () => { net.send(C2S.TEAM, { team: 'spectate' }); closeModal(true); } }, '👁 Spectate'),
          h('div.grow'),
          isHost && store.room.phase === 'results' ? h('button.btn', { onclick: () => net.send(C2S.END) }, 'Back to lobby now (host)') : null,
          isHost && store.room.phase === 'playing' ? h('button.btn.danger', { onclick: () => { if (confirm('End the match for everyone and go back to the lobby?')) net.send(C2S.END); } }, 'End match (host)') : null,
          h('button.btn.danger', { onclick: () => { if (confirm('Leave the room?')) net.send(C2S.LEAVE); } }, 'Leave room')))));
    } else {
      modalHost.replaceChildren();
    }
  }

  function openModal(kind) {
    modal = kind;
    showScores = false;
    renderScores();
    if (document.pointerLockElement) {
      expectUnlock = true;
      document.exitPointerLock();
    }
    renderModal();
    uiEvents.emit('block');
  }

  function closeModal(resume = false) {
    const wasTeams = modal === 'teams';
    modal = null;
    renderModal();
    if (wasTeams) sendReady();
    if (resume) uiEvents.emit('resume');
  }

  function openChat() {
    chatOpen = true;
    chatBox.classList.add('open');
    if (document.pointerLockElement) {
      expectUnlock = true;
      document.exitPointerLock();
    }
    renderChat();
    setTimeout(() => chatInput.focus());
    uiEvents.emit('block');
  }

  function closeChat() {
    chatOpen = false;
    chatInput.value = '';
    chatInput.blur();
    chatBox.classList.remove('open');
    renderChat();
    uiEvents.emit('resume');
  }

  function sendReady() {
    if (ready) return;
    ready = true;
    net.send(C2S.READY);
  }

  // ---------- keyboard ----------
  const onKeyDown = (e) => {
    if (e.code === 'Tab') {
      e.preventDefault();
      if (!showScores && !modal && !chatOpen) {
        showScores = true;
        renderScores();
      }
      return;
    }
    if (chatOpen) {
      if (e.code === 'Escape') {
        e.preventDefault();
        closeChat();
      }
      return;
    }
    if ((e.code === 'Enter' || e.code === 'NumpadEnter') && !modal) {
      e.preventDefault();
      openChat();
      return;
    }
    if (e.code === 'Escape') {
      // The same Esc press that released the pointer may also arrive here; don't let it close the menu again.
      if (performance.now() - menuOpenedByUnlockAt < 300) return;
      if (modal === 'menu') closeModal(true);
      else if (!modal) openModal('menu');
    }
  };
  const onKeyUp = (e) => {
    if (e.code === 'Tab') {
      showScores = false;
      renderScores();
    }
  };
  // Browsers swallow the first Esc to release pointer lock, so treat an unexpected
  // unlock as "open the pause menu".
  const onLockChange = () => {
    if (document.pointerLockElement) {
      hadLock = true;
      return;
    }
    if (expectUnlock) {
      expectUnlock = false;
      return;
    }
    if (hadLock && !modal && !chatOpen && !destroyed) {
      menuOpenedByUnlockAt = performance.now();
      openModal('menu');
    }
  };
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);
  document.addEventListener('pointerlockchange', onLockChange);
  cleanups.push(() => {
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('keyup', onKeyUp, true);
    document.removeEventListener('pointerlockchange', onLockChange);
  });

  // ---------- store subscriptions ----------
  cleanups.push(store.on('room', () => {
    renderScorebar();
    renderScores();
    if (modal) renderModal();
    gameEvents.emit('$room', store.room);
  }));
  cleanups.push(store.on('chat', renderChat));
  cleanups.push(net.on('game', (type, data) => gameEvents.emit(type, data)));

  // ---------- the API handed to the game ----------
  const api = {
    root,
    hud,
    gameId,
    get me() { return store.me; },
    get room() { return store.room; },
    get settings() { return store.room?.match?.settings ?? store.room?.settings ?? {}; },
    get teams() { return store.room?.game.teams ?? null; },
    get isHost() { return store.isHost; },
    /** True while you're watching instead of playing. React to changes with api.onRoom(). */
    get spectating() { return Boolean(store.myPlayer?.spectating); },
    /** Can you switch to `teamId` right now? (false when the host turned team switching off) */
    canPickTeam: (teamId) => canPickTeam(teamId),
    /** Join a team ('auto' for any), or 'spectate'. */
    pickTeam: (team) => net.send(C2S.TEAM, { team }),
    player: (id = store.me) => store.room?.players.find((p) => p.id === id) ?? null,
    players: () => store.room?.players ?? [],
    team: (id) => store.team(id),
    teamColor: (id) => store.teamColor(id),
    teamScore: (id) => store.room?.teamScores[id] ?? 0,

    /** Send a message to your game's server.js (arrives in onMessage(player, type, data)). */
    send: (type, data) => net.sendGame(type, data),
    /** Listen for messages from your server.js. Returns an unsubscribe function. */
    on(type, fn) {
      const off = gameEvents.on(type, fn);
      cleanups.push(off);
      return off;
    },
    /**
     * Called once when the match ends, with { winner, text, teamScores, stats, returnAt }.
     * Registering a handler replaces the framework's default toast. `returnAt` is the server time
     * (compare with api.serverNow()) when everyone goes back to the lobby. It's null if the game
     * has no results period, in which case the match screen closes right after this call.
     */
    onMatchEnd(fn) {
      matchEndHandlers.add(fn);
      const off = () => matchEndHandlers.delete(fn);
      cleanups.push(off);
      return off;
    },
    /** Called whenever the room snapshot changes (players, teams, scores, stats). */
    onRoom(fn) {
      const off = gameEvents.on('$room', fn);
      cleanups.push(off);
      return off;
    },
    serverNow: () => net.serverNow(),
    rtt: () => net.rtt,
    toast,

    ui: {
      /** True while chat, the pause menu, or the team picker is open. */
      isBlocking: () => Boolean(modal || chatOpen),
      on: (type, fn) => uiEvents.on(type, fn), // 'block' | 'resume'
      openMenu: () => openModal('menu'),
      openTeamPicker: () => openModal('teams'),
      showScorebar(show) {
        scorebarVisible = show;
        renderScorebar();
      },
      showHint(show) {
        hint.style.display = show ? '' : 'none';
      },
    },
  };

  // ---------- load + mount the game ----------
  (async () => {
    let mod;
    try {
      mod = await import(`/games/${gameId}/client/index.js`);
    } catch (err) {
      console.error(err);
      replace(loading, h('div.panel.stack', h('b', `Could not load the ${room.game.name} client.`), h('code.small', String(err.message ?? err)),
        h('button.btn', { onclick: () => net.send(C2S.LEAVE) }, 'Leave room')));
      return;
    }
    if (destroyed) return;
    const def = mod.default;
    try {
      instance = await def.mount(api) ?? {};
    } catch (err) {
      console.error(err);
      replace(loading, h('div.panel.stack', h('b', 'The game crashed while loading.'), h('code.small', String(err.message ?? err)),
        h('button.btn', { onclick: () => net.send(C2S.LEAVE) }, 'Leave room')));
      return;
    }
    if (destroyed) {
      instance.destroy?.();
      return;
    }
    loading.remove();
    renderScorebar();
    renderChat();
    // Team games: let the player pick a team on map load before spawning in.
    // Spectators who chose that in the lobby go straight in to watch.
    if (store.room.game.teams && def.teamPicker !== false && !store.myPlayer?.spectating) openModal('teams');
    else sendReady();
  })();

  return {
    el,
    /** Called by app.js on MATCH_END. Returns true if the game handled it. */
    matchEnded(result) {
      for (const fn of [...matchEndHandlers]) {
        try {
          fn(result);
        } catch (err) {
          console.error('onMatchEnd handler failed', err);
        }
      }
      return matchEndHandlers.size > 0;
    },
    destroy() {
      destroyed = true;
      try {
        instance?.destroy?.();
      } catch (err) {
        console.error('game destroy() failed', err);
      }
      for (const off of cleanups) off();
      if (document.pointerLockElement) document.exitPointerLock();
      app.setTitle();
    },
  };
}
