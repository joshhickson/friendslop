# Making a game

A game is a folder in `games/` with two required files. The server finds it automatically on start.

```
games/<id>/
  server.js          required: rules + authoritative state (Node)
  client/index.js    required: rendering + input (browser)
  bot.js             optional: a bot player. Its presence enables "Add bots" in the lobby.
  shared/            optional: code used by both sides (maps, constants). Use relative imports.
  assets/            optional: images, sounds, models. Load them with new URL('../assets/x.png', import.meta.url).
```

Fastest start: `npm run new-game -- <id> "Display Name"`. This copies `templates/starter`: a room where
everyone is a dot that walks around, plus a bot that wanders. It has no rules, so you add them.
Folders in `games/` whose names start with `_` hold code shared between games and aren't listed as games.

## Share it with a link

You don't need a server, an account on anything but GitHub, or anyone's permission to get friends
into your game.

1. **Fork** the friendslop repo on GitHub, so your copy has the same layout (`server/`, `client/`,
   `shared/`, `games/`). A game finds the kit by relative path, so it has to live in a repo shaped like this one.
2. **Put your game in `games/<id>/`** and push it. The folder name can use lowercase letters, digits,
   hyphens and underscores.
3. **Paste the folder's link** into the "Host a game from GitHub" box at play.friendslop.us
   (the box on friendslop.us sends you there), for example
   `https://github.com/you/your-fork/tree/main/games/my-game`, and press **Host this game**.
   You get the usual room link to send to your friends.

What has to be true for the link to work:

- The repo is **public**. Files load through jsDelivr, a free public CDN that serves GitHub repos.
- No single file is over **20 MB**, and the commit is under **150 MB** in all (jsDelivr's limits).
- The link names a folder inside `games/` or `templates/`, on a branch, a tag or a commit. A branch or
  tag is looked up on GitHub, from the host's browser, to find its commit.
- The fork isn't too old. If the kit changed since you forked, the room says so and tells you to update.

The link is pinned to the commit the branch points at when you paste it, so the host and every friend
run identical code. **Push a fix, then paste the link again** to play the new version.

**Trying it before you push.** Start the server with the dev CDN, which serves this checkout's own
files the way jsDelivr would:

```sh
DEV_CDN=1 npm start
```

On Windows PowerShell, use `$env:DEV_CDN = "1"; npm start`. Then open the home screen and press
**Try the starter game**, or type a folder of this checkout, such as `games/my-game`, into the link box
instead of a GitHub link. That runs the game through the same frame, relay and checks as a game from
GitHub. The dev CDN only works when the server listens on this machine (`HOST` is loopback).
`npm run play` still runs a game in your own `games/` folder the old way (on your server), which is the
quickest loop while you write it.

### How a game from a link runs

Friendslop's server never loads or runs a game from a link. Your game runs in browsers:

- **The host's browser runs your rules.** Your `server.js` and any `bot.js` run in a Web Worker inside a
  sandboxed frame on the host's page, with the same `ctx` as below. A background tab keeps ticking.
- **Every player's browser runs your client.** `client/index.js` runs in the same kind of frame, on each
  player's page, host included.
- **The server relays.** It passes game messages between the frames and keeps the room: passwords,
  lobby, teams, chat, scores, stats and results.

Because the host's browser runs the rules, **the host can change scores, and the host controls the
lobby bots.** The banner over an unreviewed game says so: "The host's computer runs the game, so the
host could change the score. Choose your friends carefully." A game that can't tolerate a cheating
host needs a trusted server, which means running friendslop yourself.

### What the fence stops, and what it doesn't

Game code is untrusted, whoever wrote it. It runs in
`<iframe sandbox="allow-scripts allow-pointer-lock">` **without** `allow-same-origin`, so the frame has
an opaque origin of its own.

The fence stops:

- Reading friendslop.us storage, cookies, saved sessions or pages, and touching any other room.
- Ordinary network requests. The frame's Content Security Policy limits what it can load (scripts,
  images, audio, data) to the CDN, plus friendslop's own frame code.
- Talking to the server directly. The frame can only `postMessage` the friendslop page, and the page
  checks that each message came from that frame, has a known shape and is under the size limit.
  The page owns the WebSocket.

The fence is **best effort**, and it doesn't stop:

- **Seeing players' IP addresses.** A game can still, for example, navigate its frame to another
  address or use WebRTC, and either one can reach an outside server that sees the player's IP address,
  the way any website can. The friendslop page notices a frame that navigates away and removes it (if it was the
  host's frame, the match ends), which doesn't undo the request that already left.
- **Showing anything on screen,** including a fake login box.

Players are told about the first one before an unreviewed game first loads: they see "Heads up:
nobody has checked this game. Like any website, it can see your IP address. It probably just wants to
show you some cubes. Play anyway?" once per repo, and their answer is remembered in that browser. An
unreviewed game also wears a banner naming the maker and the repo, with a report link that opens a
prefilled GitHub issue. A repo on the blocklist refuses to load.

### What the server checks

The server doesn't trust the host's frame with anything beyond its own room. Every relayed item is
checked, and a bad one is skipped:

- Only the host can relay, and only for the match it started. A late relay is refused.
- A batch holds at most 512 items and 256 KB, and a runner has its own rate limit. A match also has a
  delivery budget of 2000 a second (bursts up to 4000): a message costs one for each player it
  reaches, and a score or stat change costs one. A broadcast to a full room 60 times a second fits.
  A runner that keeps going over either ends the match with "The game sent far too many messages, so
  friendslop hung up on it." The relayed messages count toward the daily traffic budget like any other.
- Sizes are counted in UTF-8 bytes. A message from a player's client holds a little under 16 KB of
  JSON, and text in most non-Latin scripts takes two or three bytes a character.
- A message to players (`send`, `broadcast`, `sendTeam`) reaches only players in the match, and its
  type is at most 64 characters.
- Stat keys match `^[A-Za-z0-9_]{1,32}$`, a player has at most 32 of them, and a value is a finite
  number or text of at most 64 characters. Text is cleaned like a name (control characters and
  direction marks are removed, spaces collapsed).
- Scores and teams must name a real team and a finite number, a player must exist to be moved, and
  `announce` is cleaned, trimmed to the chat limit and rate limited.
- `endMatch` carries a winner of at most 64 characters, and its text and results period are cleaned
  by the room.

The checks keep a bad game inside its own room. They can't tell a score the host earned from one the
host typed.

## Mental model

```
 browser (client/index.js)                         server (server.js)
 ───────────────────────────                       ──────────────────────────
 api.send('move', {...})   ───── WebSocket ─────▶  onMessage(player, 'move', data)
 api.on('state', fn)       ◀──────────────────────  ctx.broadcast('state', {...})   (e.g. in tick)
```

- Your **`server.js` is the authority.** Clients send intent (input, "I fired"), and `server.js` decides outcomes (damage, score).
  Validate everything a client sends: use `isNum`, `isVec`, `clamp`. Where `server.js` runs depends on how the game is
  hosted: on your own server for a game in `games/`, or in the host's browser for a game shared by link
  (see [Share it with a link](#share-it-with-a-link)). The code is the same either way.
- **The framework already handles:** rooms, passwords, host controls, lobby, team picking (including an in-game picker on load),
  team scores, per-player stats, the Tab scoreboard, chat, the Esc menu, match start/end, reconnects and late joiners.
- Messages are JSON. Keep them small (shorten keys, round numbers) for fast-paced games.

## server.js

```js
// Relative imports only (see below).
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

**Use relative imports only in `server.js`, `bot.js` and anything they import (including `shared/`).**
A game shared by link runs them in a Web Worker, and import maps don't apply in workers, so an
absolute path like `/shared/kit/math.js` or a bare name like `three` won't resolve there. Write
`../../server/kit/index.js` or `./shared/map.js`. Your `client/index.js` runs on the page and can
use the absolute `/client/kit/...` paths shown below.

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

A bot sees the same messages your client gets and sends the same ones, and the server lists it as a
player. If a game has a `bot.js`, the host sees a **Bots** panel in the lobby: how many, which team,
and difficulty (`easy`, `normal`, `hard`).

Where a bot runs depends on the room:

- **A game in `games/`, on your own server:** each lobby bot is a real player connection. It opens its
  own WebSocket, joins the room, and the server validates it like any human, so it can't do anything
  a player couldn't.
- **A game shared by link:** lobby bots run in the host's browser, in the same worker as `server.js`,
  and their messages never cross the network. The host controls them, so they are exactly as honest as
  the host. Use relative imports in `bot.js`.
- **Outside programs** (the `npm run bot` runner, or your own code) are real players over WebSocket
  in both cases. They join with the room code and password.

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

Bots are plain local code and make no network calls of their own.
`templates/starter/bot.js` is the smallest working bot. For a bot that walks around a 3D level,
`NavGrid` does the pathfinding (see the server kit helpers above).

**Driving a player from another program.** Anything that can open a WebSocket can play: connect to
`/ws` with the page's origin as the `Origin` header, send
`{ t: 'room:join', roomId, password, name, bot: true }`, then follow `shared/protocol.js`.
Connecting to `/ws?z=1` instead gets the server's messages packed into one compressed stream, about
an eighth of the size; `shared/protocol.js` says how to unpack them, and `client/js/unpack.js` does it.
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

### Assets

Build asset URLs from `import.meta.url`, so they resolve inside the same pinned commit as your code:

```js
const ship = new URL('../assets/ship.png', import.meta.url).href;   // from client/index.js
```

This replaces the old `/games/<id>/assets/...` paths, which only exist on a server that has the game in
`games/`. The `new URL(...)` form works in both places. The frame loads images, audio and data from
the CDN only, so an asset has to be a file in your repo (under 20 MB).

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
- **`three.js` kit:** `createStage` (renderer, scene, camera, lights, resize), `loop`, `buildBoxWorld` (instanced boxes; `{ edges: color }` outlines them),
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
- `DEV_CDN=1 npm start` and **Try the starter game** runs a game through the link path (frame, relay
  and checks) without GitHub. See [Share it with a link](#share-it-with-a-link).
- `npm test`: see `test/spectate.test.js` and the test-only games in `test/fixtures/games/` for how to
  script players against a real server.
