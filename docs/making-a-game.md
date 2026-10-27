# Making a game

A game is a folder in `games/` with two required files. The server finds it automatically on start.

```
games/<id>/
  server.js          required: rules + authoritative state (Node)
  client/index.js    required: rendering + input (browser)
  bot.js             optional: a bot player. Its presence enables "Add bots" in the lobby.
  shared/            optional: code used by both sides (maps, constants). Use relative imports.
  assets/            optional: served at /games/<id>/assets/...
```

Fastest start: `npm run new-game -- <id> "Display Name"`. This copies `templates/starter`: a room where
everyone is a dot that walks around, plus a bot that wanders. It has no rules, so you add them.
Folders in `games/` whose names start with `_` hold code shared between games and aren't listed as games.

## Mental model

```
 browser (client/index.js)                         server (server.js)
 ───────────────────────────                       ──────────────────────────
 api.send('move', {...})   ───── WebSocket ─────▶  onMessage(player, 'move', data)
 api.on('state', fn)       ◀──────────────────────  ctx.broadcast('state', {...})   (e.g. in tick)
```

- The **server is the authority.** Clients send intent (input, "I fired"), and the server decides outcomes (damage, score).
  Validate everything a client sends: use `isNum`, `isVec`, `clamp`.
- **The framework already handles:** rooms, passwords, host controls, lobby, team picking (including an in-game picker on load),
  team scores, per-player stats, the Tab scoreboard, chat, the Esc menu, match start/end, reconnects and late joiners.
- Messages are JSON. Keep them small (shorten keys, round numbers) for fast-paced games.

## server.js

```js
import { defineGame, clamp, isNum } from '../../server/kit/index.js';

export default defineGame({
  id: 'my-game',                    // must match the folder name
  name: 'My Game',
  description: 'Shown in the lobby.',
  minPlayers: 1,                    // host can't start below this
  maxPlayers: 8,
  tickRate: 20,                     // tick() calls per second (1-120)

  // Optional. Omit for free-for-all. With teams, players get auto-balanced on join,
  // pick teams in the lobby, and the HUD shows team scores.
  teams: [
    { id: 'red', name: 'Red', color: '#e5484d' },
    { id: 'blue', name: 'Blue', color: '#3e8ef7' },
  ],
  joinInProgress: true,             // can people join while a match runs? (default true)
  teamChangeInProgress: true,       // can people switch teams mid-match? (default true)

  // Host-editable settings in the lobby. Type is inferred from `default` (number/boolean)
  // or set `options` for a dropdown. Values are validated and clamped for you.
  settings: {
    rounds: { label: 'Rounds', default: 5, min: 1, max: 20 },
    chaos: { label: 'Chaos mode', default: false },
    map: { label: 'Map', default: 'small', options: [{ value: 'small', label: 'Small' }, { value: 'big', label: 'Big' }] },
  },

  // Columns of the Tab scoreboard: stat keys you set with ctx.addStat().
  scoreboard: [{ key: 'points', label: 'Points' }, { key: 'deaths', label: 'Deaths' }],

  // Shown in the bottom-right hint box during the match.
  controls: [['WASD', 'move'], ['Click', 'action']],

  // Optional: seconds to stay in the match after endMatch() so you can show your own ending
  // (see "Match endings" below). Default 0 = straight back to the lobby.
  // resultsSeconds: 8,

  // Optional (team games with a bot.js): top both teams up with bots when the match starts, and
  // swap bots out as humans join. `setting` names a boolean setting that switches it on/off;
  // `difficultySetting` a select setting with 'easy' | 'normal' | 'hard'. Spectators don't take
  // team slots (a few extra seats are reserved for them).
  // autoFill: { perTeam: 10, setting: 'fillBots', difficultySetting: 'botDifficulty' },

  create(ctx) {
    // Called once when the host starts the match. Keep all match state in this closure.
    const state = new Map();

    return {
      onPlayerJoin(player) {},                 // player loaded into the match (start, late join, or reconnect)
      onPlayerLeave(player) {},                // disconnected or left (they may come back: onPlayerJoin again)
      onTeamChange(player, oldTeam) {},        // switched team mid-match (player.team is the new one)
      onMessage(player, type, data) {},        // from api.send(type, data) on the client. Validate `data`!
      tick(dt) {},                             // dt in seconds. ctx.time = seconds since start
      onResults(result) {},                    // endMatch() was called and a results period started (optional)
      onSpectatorJoin(player) {},              // a spectator loaded the match: send them the current world (optional)
      onEnd() {},                              // match is over, clean up
    };
  },
});
```

Hooks are all optional and wrapped in try/catch. A bug in your game logs an error and
doesn't crash the server. After repeated errors the match is stopped.

### `player` objects

Read-only views: `{ id, name, team, ping, connected, bot, spectating, stats }`. They always reflect current values.
`bot` is true for bots, which are otherwise ordinary players: your server code needs no special cases for them.

### Spectators

Any player can spectate instead of playing: from the lobby ("Spectate instead"), from the in-game
team picker, or from the Esc menu. The framework keeps spectators **out of your game logic**:

- They never trigger `onPlayerJoin`, they aren't in `ctx.players()`, and their game messages are dropped.
- They **do** receive everything you `ctx.broadcast()`, so they see the same world.
- Optional hook `onSpectatorJoin(player)`: send them whatever a late joiner needs (for example a snapshot of the world).
- Switching mid-match is handled for you: playing → spectating calls `onPlayerLeave`, and back calls `onPlayerJoin`.
- `ctx.spectators()` lists them. Spectators don't count toward `minPlayers`, and bots can't spectate.

**Team switching** is a host option in the lobby ("Team switching mid-match", default from your
`teamChangeInProgress`). When it's off, a player can only rejoin the team they started the match on,
even after spectating, and the client's team pickers grey out the other teams.

On the client, `api.spectating` tells you whether to show a spectator camera,
`api.pickTeam(teamId | 'auto' | 'spectate')` changes it, and `api.canPickTeam(teamId)` respects the lock.
Spectators who chose that in the lobby skip the "pick your team" dialog.

### `ctx` API

| | |
| --- | --- |
| `ctx.settings` | the lobby settings for this match (validated) |
| `ctx.teams` | team definitions, or `null` |
| `ctx.time`, `ctx.dt`, `ctx.tick` | match clock (seconds), last tick's dt, tick counter |
| `ctx.now()` | server wall clock (ms). The client's `api.serverNow()` is synced to it. |
| `ctx.players()` | players currently in the match |
| `ctx.getPlayer(id)` / `ctx.teamPlayers(team)` | lookups |
| `ctx.send(player, type, data)` | message one player (player or id) |
| `ctx.broadcast(type, data, { except })` | message everyone in the match |
| `ctx.sendTeam(team, type, data)` | message one team |
| `ctx.addTeamScore(team, n)` / `setTeamScore` / `teamScore` | team scores (shown in lobby + HUD) |
| `ctx.addStat(player, key, n)` / `setStat` / `stat` | per-player stats (shown in scoreboard) |
| `ctx.setTeam(player, team)` | move a player (e.g. auto-balance) |
| `ctx.announce(text)` | system message in chat |
| `ctx.endMatch({ winner, text }, { resultsSeconds? })` | end the match. `winner` = team id or player id; `text` shown to all. The second argument overrides the game's `resultsSeconds` for this ending. |
| `ctx.phase` | `'playing'`, or `'results'` during a results period |
| `ctx.log.info(...)` | logging with room/game prefix |

### Server kit helpers (`server/kit/index.js`)

- **Math:** `v3.add/sub/scale/dot/len/dist/lerp/normalize`, `clamp`, `lerp`, `lerpAngle`, `dirFromYawPitch`
- **Validation:** `isNum(x)`, `isVec(v, n=3)`
- **Raycasts:** `rayAABB`, `raySphere`, `raycastBoxes(origin, dir, boxes, maxDist)`, `pointInAABB`
- **Physics:** `moveCharacter(state, dt, boxes, body)` and `collides(pos, boxes, body)`, a box-world character controller. Use the same code on the client for prediction.
- **`History`:** time-indexed buffer for lag compensation (server) or interpolation (client)
- **`Cooldown`, `Scheduler`:** timers driven by `ctx.time`
- **`NavGrid`:** grid pathfinding over a box world, for bots: `new NavGrid(boxes, { bounds, cell, body })`, then `findPath(from, to)`, `clearLine(a, b)`, `nearestWalkable(x, z)`

## bot.js (optional)

A bot is a **real player connection**. It opens its own WebSocket to the server, joins the room,
receives the same messages your client gets and sends the same ones. The server validates it like
any human, so a bot can't do anything a player couldn't. If a game has a `bot.js`, the host sees a
**Bots** panel in the lobby: how many, which team, and difficulty (`easy`, `normal`, `hard`).

```js
// games/my-game/bot.js  (runs in Node; import shared code with relative paths)
export default {
  mount(api) {
    // Same shape as the browser api: api.me, api.player(id), api.players(), api.team(id),
    // api.settings, api.send(type, data), api.on(type, fn), api.onRoom(fn), api.serverNow().
    // Extras: api.options.difficulty ('easy' | 'normal' | 'hard'), api.chat(text), api.log.
    api.on('state', (s) => { /* decide what to do */ });
    const timer = setInterval(() => api.send('input', { dx: 1, dy: 0 }), 50);
    return { destroy() { clearInterval(timer); } };   // match ended
  },
};
```

Bots are plain local code. They make no network calls except to your own game server.
`templates/starter/bot.js` is the smallest working bot. For a bot that walks around a 3D level,
`NavGrid` does the pathfinding (see the server kit helpers above).

**Driving a player from another program.** Anything that can open a WebSocket can play: connect to
`/ws` with the page's origin as the `Origin` header, send
`{ t: 'room:join', roomId, password, name, bot: true }`, then follow `shared/protocol.js`.
`server/bots/client.js` (`BotClient`) is a ready-made Node client, and `scripts/bot.js` runs one from
the command line:

```sh
npm run bot -- --room ABC123 --password pizza --count 2 --difficulty hard
npm run bot -- --url https://xyz.trycloudflare.com --room ABC123 --password pizza
```

To plug in a different decision-maker, keep `BotClient` for the connection and replace the
`loadBrain` function with your own `{ mount(api) }` object.

## client/index.js

```js
import { defineClientGame, Input, sfx, h } from '/client/kit/index.js';
// For 3D: import { THREE, createStage, loop, buildBoxWorld, makeCharacter, ... } from '/client/kit/three.js';

export default defineClientGame({
  // teamPicker: false,   // skip the "pick your team" dialog on load
  mount(api) {
    // api.root: full-screen container for your canvas. api.hud: overlay for your HUD.
    const input = new Input(api, api.root, { pointerLock: false });

    api.on('state', (data) => { /* from ctx.broadcast('state', ...) */ });
    api.send('input', { dx: 1, dy: 0 });   // arrives in onMessage(player, 'input', data)

    return {
      destroy() { input.destroy(); },      // match ended: stop loops, remove listeners
    };
  },
});
```

### `api`

| | |
| --- | --- |
| `api.root`, `api.hud` | DOM containers. HUD is click-through; add class `interactive` to clickable HUD elements. |
| `api.me` | your player id |
| `api.player(id?)`, `api.players()` | room players: `{ id, name, team, connected, inMatch, ping, stats }` |
| `api.teams`, `api.team(id)`, `api.teamColor(id)`, `api.teamScore(id)` | team info |
| `api.settings` | match settings |
| `api.isHost` | |
| `api.spectating` | you're watching instead of playing (changes arrive via `api.onRoom`) |
| `api.pickTeam(team)`, `api.canPickTeam(team)` | join a team, `'auto'`, or `'spectate'`; check the host's team-switch lock |
| `api.send(type, data)` | message your server.js |
| `api.on(type, fn)` | listen to your server.js. Auto-unsubscribed when the match ends. |
| `api.onRoom(fn)` | room snapshot changed (players, teams, scores, stats) |
| `api.onMatchEnd(fn)` | the match ended: `fn({ winner, text, teamScores, stats, returnAt })`. Registering replaces the default toast. |
| `api.serverNow()` | estimated server clock (ms). Use it for interpolation and lag compensation. |
| `api.rtt()` | round-trip time (ms) |
| `api.toast(text)` | small notification |
| `api.ui.isBlocking()` | chat/menu open. `Input` already ignores input then. |
| `api.ui.on('resume', fn)` | menu/chat closed |
| `api.ui.showScorebar(bool)`, `api.ui.showHint(bool)` | toggle framework HUD bits |

### Client kit

- **`Input`:** keys (`down`, `pressed`), mouse (`mouseDown`, `clicked`, `consumeMouse`), `axes()` for WASD, and pointer lock.
  Pauses automatically while chat or menus are open.
- **`sfx`:** synthesized sounds with no asset files: `sfx.play('shoot' | 'hit' | 'hurt' | 'kill' | 'die' | 'pickup' | 'score' | 'alarm' | 'click' | 'jump')`.
  Add your own with `sfx.define(name, { type, freq: [from, to], dur })`.
- **`three.js` kit:** `createStage` (renderer, scene, camera, lights, resize), `loop`, `buildBoxWorld` (instanced boxes),
  `makeCharacter`, `makeFlag`, `textSprite`, `tracer`, `burst`, `Effects`, `flatMat`, `box`.
- **Everything in `shared/kit`** (math, physics, `History`, timers) is available here too.

## Patterns

**Turn-based or slow games** (cards, trivia, drawing): skip `tick`. Handle `onMessage`, update state, and
`ctx.broadcast('state', fullState)` after every change. Use `ctx.send` for private info such as hands.

**Fast-paced games:**
- Client predicts its own movement with the shared physics and sends position about 30x/s.
  The server checks speed, walls and bounds and sends a `correct` message if something is off.
- The server broadcasts compact snapshots about 20x/s. Clients render other players about 100 ms in the past,
  interpolated with `History`.
- For hitscan weapons, the client sends `t = api.serverNow() - interpDelay`. The server rewinds targets to `t`
  (capped) using a per-player `History`, so players hit what they saw.

**Match endings.** By default, `ctx.endMatch()` sends everyone straight back to the lobby with a toast,
and the lobby shows the last result. To show your own ending (a results screen, a victory lap, a slow-mo replay):

1. Set `resultsSeconds: 8` in `defineGame` (or pass `{ resultsSeconds }` to a particular `endMatch` call).
   The room enters a `'results'` phase. Your match keeps ticking and players stay on the match screen.
   Nobody can start a new match until the period ends, but the host can skip it from the Esc menu.
2. On the server, `onResults(result)` fires. Check `ctx.phase === 'results'` in `tick` to freeze gameplay,
   or keep it running for fun.
3. On the client, `api.onMatchEnd((result) => { ... })` lets you draw your ending into `api.hud`. `result.returnAt`
   is when everyone returns to the lobby. Compare it with `api.serverNow()` for a countdown.

`destroy()` and `onEnd()` run when the results period is over, as usual. A game with neither setting
behaves exactly as before.

```js
// client: a minimal custom ending
api.onMatchEnd((r) => {
  const winner = api.team(r.winner)?.name ?? api.player(r.winner)?.name;
  api.hud.append(h('div', { style: { position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: '48px' } },
    winner ? `${winner} wins!` : r.text));
});
```

**Shared data** (maps, constants) goes in `games/<id>/shared/` with **relative imports only**, so the
same file works in Node and the browser.

## Debugging

- `npm run dev` restarts the server on server-side changes. Client changes just need a browser refresh.
  A refresh keeps your seat in the room.
- In the browser console, `friendslop.store.room` is the current room state and `friendslop.net` is the connection.
- `LOG_LEVEL=debug npm start` for chatty logs.
- `npm test`: see `test/spectate.test.js` and the test-only games in `test/fixtures/games/` for how to
  script players against a real server.
