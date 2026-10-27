# Instant Game Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A maker pastes a GitHub link to a game folder and gets a working room link. The game runs in the host's browser inside a sandboxed frame, and the server only relays messages.

**Architecture:** The server keeps everything it does today (rooms, lobby, teams, scores, stats, results, limits). For a room made from a GitHub source, `RemoteMatch` replaces `Match`. It forwards player messages and lifecycle events to the host's game runner, and it applies the runner's sends and score changes after checking them. Game code (the client, server hooks and bot brains) loads from jsDelivr, pinned to a commit, into an `<iframe sandbox>` with an opaque origin. The friendslop page bridges that frame to the WebSocket and to the overlay.

**Tech Stack:** Node 20+, `ws`, `node:test`; browser ES modules, import maps, `postMessage`, possibly a module Web Worker; jsDelivr (`cdn.jsdelivr.net/gh/`), the GitHub REST API.

**Spec:** `docs/superpowers/specs/2026-10-26-game-hosting-design.md` (approved by Josh 2026-10-26). Read it first; this plan argues from it.

**Scope:** This is plan 1 of 2. Plan 2 covers listings: the `listings/` pull request flow, its automatic check, the GitHub Pages generator, and showing listed games without the banner. It comes after this lands. Everything here treats every GitHub game as unreviewed.

## Global Constraints

- Nothing is pushed. All commits are local in `D:\dev\friendslop` (and `D:\dev\friendslop-site` in Task 10). Commit with `git -c safe.directory=D:/dev/friendslop -c user.name="Josh Hickson" -c user.email="84687634+joshhickson@users.noreply.github.com" commit`. End each message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. No global git config changes.
- Write files with LF line endings (core.autocrlf is on).
- Josh's prose rules for anything a player reads, and for docs: hyphens only, never an em or en dash, and no sentence that depends on a dash.
- Every player-facing string lives in `shared/copy.js` (Task 2), so Josh can rewrite the jokes in one place. Jokes never replace the information: each message still says what happened and what to do.
- Existing server-run games (`GAMES_DIR`) keep working unchanged. All 39 existing tests keep passing after every task. Run `npm test` from `D:\dev\friendslop`.
- `RemoteMatch` must never load or run game code on the server.
- The `ctx` API names in `server/match.js` (`players`, `getPlayer`, `teamPlayers`, `spectators`, `send`, `broadcast`, `sendTeam`, `teamScore`, `setTeamScore`, `addTeamScore`, `stat`, `setStat`, `addStat`, `setTeam`, `announce`, `endMatch`, `phase`, `now`, `time`, `dt`, `tick`, `matchId`, `game`, `settings`, `teams`, `log`) are the contract. The runner implements every one of them with the same meaning.
- Defaults: `GAME_CDN=https://cdn.jsdelivr.net/gh/`, `THREE_BASE=https://cdn.jsdelivr.net/npm/three@0.186.1/`, `GITHUB_API=https://api.github.com`, `REPORT_URL=https://github.com/joshhickson/friendslop/issues/new`, `BLOCKLIST=<repo>/blocklist.json`. `DEV_CDN=1` works only when `HOST` is loopback.
- jsDelivr limits (from the spec): public repos only, 20 MB per file, 150 MB per repo version.
- Bot brains and game `server.js` files use only relative imports, because import maps do not apply inside workers (Task 1 confirms whether a worker is used).

## Review Focus

1. **The host's tab goes to the background mid-match.** Players expect the game to keep running at its tick rate. Task 1 measures it, and Task 7 adds a browser check.
2. **The host refreshes or closes the tab mid-match.** Everyone expects the "host left" message, a return to the lobby, and a room that still works. Task 4 tests it on the server, and Task 8 adds a browser check.
3. **Pasted GitHub links in odd shapes:** `/blob/` instead of `/tree/`, a trailing slash, a repo root with no game folder, a branch name containing a slash, a 40-character commit in place of a branch, a repo that doesn't exist (404), and the GitHub API rate limit (403). Each gets a clear message. Task 2 tests the parsing, and Task 9 tests the resolver errors.
4. **A game that throws in `create()`, or in every tick.** The match ends with the crash message and the room survives. Task 6 tests it.
5. **A game that sends too much in one tick.** The runner ends the match with a message, and nobody gets disconnected. Task 6 tests the runner, and Task 4 tests that the server refuses an oversized batch.

---

### Task 1: Browser spike (throwaway)

Settle four browser behaviours the design depends on before building on them. Nothing from this task is committed except the results, which go into this plan.

**Files:**
- Create (scratchpad only, outside the repo): `spike/parent.html`, `spike/frame.html`, `spike/game.js`, `spike/kit/thing.js`, `spike/serve.mjs`

- [ ] **Step 1: Build two origins.** `spike/serve.mjs` serves the spike folder on `127.0.0.1:7801` (the "play" origin, serving the parent and frame pages) and `127.0.0.1:7802` (the "CDN" origin, serving `game.js` and `kit/`). Every response carries `Access-Control-Allow-Origin: *` and `Cross-Origin-Resource-Policy: cross-origin`. `frame.html` gets the header `Content-Security-Policy: sandbox allow-scripts allow-pointer-lock; frame-ancestors 'self'`.
- [ ] **Step 2: Check the scoped import map.** `frame.html`'s import map has `scopes: { "http://127.0.0.1:7802/": { "http://127.0.0.1:7802/kit-abs/": "http://127.0.0.1:7802/kit/" } }`, and `game.js` (loaded from 7802) does `import '/kit-abs/thing.js'`. Pass: `thing.js` loads, and the frame's own `/x.js` from 7801 is not remapped.
- [ ] **Step 3: Check a module worker from the opaque frame.** The frame creates `new Worker(URL.createObjectURL(new Blob([src], {type:'text/javascript'})), {type:'module'})`, where `src` does `await import('http://127.0.0.1:7802/game.js')` and posts its `setInterval(…, 50)` tick count every second. Pass: the worker starts and imports. Then put the tab in the background for 20 s. Pass: about 20 ticks a second continue.
- [ ] **Step 4: Check the same tick on the frame's main thread** in the background, for comparison. Record the rate.
- [ ] **Step 5: Check pointer lock.** A canvas in the frame calls `requestPointerLock()` on click. Pass: the parent's `document.pointerLockElement` is the `<iframe>`, the parent receives `pointerlockchange`, and the parent's `document.exitPointerLock()` releases it.
- [ ] **Step 6: Check navigation detection.** A button in the frame sets `location.href = 'http://127.0.0.1:7801/elsewhere'`. Pass: the parent's iframe `load` listener fires a second time.
- [ ] **Step 7: Check isolation.** The frame tries `parent.document`, `localStorage` and `document.cookie`. Pass: each throws or is empty.
- [ ] **Step 8: Record the results** under "Spike results" at the end of this plan. Set **RUNNER_LOCATION** to `worker` if Step 3 passed (with module import and background rate), otherwise `main`. Note any header or CSP the browser needed that differs from Step 1. Use the built-in browser (`mcp__Claude_Browser__*`) to drive the checks and `javascript_tool` to read values.
- [ ] **Step 9: Commit this plan file** with the results: `docs: spike results for instant game links`.

---

### Task 2: Game sources, copy, and serving the frame's files

**Files:**
- Create: `shared/gameref.js`, `shared/copy.js`, `server/blocklist.js`, `blocklist.json`, `test/gameref.test.js`
- Modify: `server/config.js`, `server/server.js` (mounts, headers, HELLO via `connection.js`), `server/connection.js:30-34`, `shared/protocol.js` (ERRORS), `server/kit/index.js`, `client/kit/index.js`, `client/js/app.js:118`

**Interfaces:**
- Produces, in `shared/gameref.js`:
  - `parseRef(str) -> { user, repo, commit, path } | null`, for `gh:<user>/<repo>@<40 hex>/<path>`. `user` matches `^[A-Za-z0-9-]{1,39}$` and `repo` matches `^[A-Za-z0-9._-]{1,100}$`. `path` is one or more `[a-z0-9_-]` segments with no `..`.
  - `formatRef({ user, repo, commit, path }) -> string`
  - `refBase(cdnBase, ref) -> string`, which returns `${cdnBase}${user}/${repo}@${commit}/` (accepts a ref string or object).
  - `repoKey(ref) -> string`, which returns lowercase `user/repo`.
  - `parseGithubUrl(url) -> { user, repo, rev, path } | { error }`. Errors are `'not_github'` and `'no_game_path'`. It accepts `/tree/` and `/blob/` and a trailing slash. `path` starts at the first segment named `games` or `templates`; everything between `tree/` and there is `rev`, so slashes in branch names survive.
- Produces `shared/copy.js` with `export const COPY = Object.freeze({...})`. It holds the spec's Voice lines verbatim as the starting text: `unreviewedBanner(maker, repo)`, `firstLook`, `hostCanCheat`, `hostLeft`, `dataBudget`, `idleClosed`, `forkTooOld`, `blocked`, `gameCrashed(msg)`, `gameTooChatty`, `gameLeftFriendslop`, `badLink(reason)`.
- Produces config keys `gameCdn`, `threeBase`, `githubApi`, `reportUrl`, `devCdn` (true only with `DEV_CDN=1` and a loopback host), and `blocklist` (a `Set<string>` of repo keys loaded by `loadBlocklist(path)`).
- Produces HELLO field `remote: { cdn, three, githubApi, reportUrl, dev }`. `cdn` is `'/dev-cdn/gh/'` when `devCdn` is on, else `gameCdn`. `three` is `'/vendor/three/'` when `devCdn` is on, else `threeBase`.
- Produces `KIT_VERSION = 1`, exported from both `server/kit/index.js` and `client/kit/index.js`.
- Produces ERRORS `game_blocked`, `bad_source`, `not_runner`, `relay_too_big`, with text from COPY. `traffic_budget` and the idle toast switch to `COPY.dataBudget` and `COPY.idleClosed`.

- [ ] **Step 1: Write the failing tests** in `test/gameref.test.js`:
  - `parseRef round-trips formatRef`: `formatRef(parseRef(s)) === s` for `gh:josh/friendslop@<40 a>/games/tag`.
  - `parseRef rejects bad refs`: `null` for a short commit, `games/../x`, `user/re po`, and a missing `gh:`.
  - `parseGithubUrl handles the shapes makers paste`:
    - `https://github.com/a/b/tree/main/games/tag` gives `{user:'a',repo:'b',rev:'main',path:'games/tag'}`.
    - `/blob/` and a trailing `/` give the same result.
    - `tree/feature/x/games/tag` gives `rev:'feature/x'`.
    - `https://github.com/a/b` gives `{error:'no_game_path'}`.
    - `https://gitlab.com/a/b` gives `{error:'not_github'}`.
  - `refBase builds the CDN folder`: `refBase('https://cdn.jsdelivr.net/gh/', ref) === 'https://cdn.jsdelivr.net/gh/a/b@<sha>/'`.
  - `dev CDN serves the repo with CORS only when enabled`. With `DEV_CDN=1`, GET `/dev-cdn/gh/x/y@<40 0>/templates/starter/server.js` returns 200, `Access-Control-Allow-Origin: *` and `Cross-Origin-Resource-Policy: cross-origin`. Without the flag it returns 404.
  - `hello carries the remote settings`: `messages[0].remote.reportUrl` equals the default, and `remote.dev` is false.
  - `the blocklist loads repo keys lowercased`: `loadBlocklist` on a temp file `{"repos":["A/B"]}` returns a Set with `'a/b'`.
- [ ] **Step 2: Run** `node --test test/gameref.test.js`. Expected: FAIL, because the modules are missing.
- [ ] **Step 3: Implement** `shared/gameref.js`, `shared/copy.js`, `server/blocklist.js`, `blocklist.json` (`{ "repos": [] }`), the config keys, and the HELLO field.
  - Add mounts in `server/server.js`: `/frame/` serves `client/frame/`, and `/dev-cdn/gh/<u>/<r>@<c>/<path>` serves `ROOT/<path>` when `devCdn` is on.
  - Responses under `/frame/`, `/dev-cdn/` and `/vendor/` get `Access-Control-Allow-Origin: *` and `Cross-Origin-Resource-Policy: cross-origin` in place of `same-origin`.
  - The parent page's CSP `connect-src` adds the `githubApi` origin.
- [ ] **Step 4: Run** `npm test`. Expected: all tests pass, the old ones included.
- [ ] **Step 5: Commit:** `Game sources, player-facing copy in one place, and CORS for frame files`.

---

### Task 3: Rooms made from a GitHub source

**Files:**
- Modify: `server/kit/defineGame.js`, `server/rooms.js:26-44`, `server/room.js` (`#setGame`, `configure`, `snapshot`), `shared/protocol.js` (C2S.CREATE comment), `client/js/screens/lobby.js:82`
- Test: `test/remote.test.js`

**Interfaces:**
- Consumes: `parseRef`, `repoKey` (Task 2); `config.blocklist`.
- Produces `defineRemoteGame(meta, source) -> def` in `server/kit/defineGame.js`.
  - It rebuilds the definition through the same checks as `defineGame`: settings arrive in normalized array form and are converted back to an object keyed by `key`; `null` min or max means unbounded. It returns the same frozen shape as `defineGame`, plus `source` (the ref string) and `hasBot` (a boolean), with `create: null`.
  - Caps: `name` cleaned to 40 characters, `description` to 200; at most 8 teams, 32 settings and 8 scoreboard columns; `controls` at most 16 `[key, what]` string pairs of at most 24 and 40 characters. It throws `Error` with a readable message on anything else.
- Produces `room:create { name, password, source, def }`. With `source`, the room's game comes from `defineRemoteGame(def, source)`; `game` is ignored. Errors: `bad_source` (with the thrown message) and `game_blocked`.
- Produces in the room snapshot `game.source` (ref string or `null`) and `botsSupported` from `def.hasBot` for remote games.
- `room:config { game }` in a remote room returns `bad_request`. Settings and options work as today. The lobby hides the game picker when `room.game.source` is set.

- [ ] **Step 1: Write the failing tests** in `test/remote.test.js`. Use the meta from `describeGame` of `templates/starter/server.js`, written as a literal in the test for now (Task 6 swaps in `describeGame`), and `source = 'gh:test/friendslop@' + '0'.repeat(40) + '/templates/starter'`.
  - `a room can be made from a GitHub source`: the welcome's `room.game.source === source`, `room.game.name === 'Starter'`, `room.maxPlayers === 12`.
  - `a bad definition is refused with a reason`: `def.teams` with 9 teams gives the error `bad_source`, and the message mentions teams.
  - `a malformed source is refused`: `source: 'gh:nope'` gives `bad_source`.
  - `a blocked repo is refused`: with `BLOCKLIST` pointing at a temp file listing `test/friendslop`, the result is `game_blocked`.
  - `settings from a remote definition are coerced by the server`: for a meta with a number setting `{key:'target',min:3,max:100,default:15}`, `room:config { settings:{target:999} }` gives `room.settings.target === 100`.
  - `a remote room cannot switch to a server game`: `room:config { game:'dots' }` gives `bad_request`.
- [ ] **Step 2: Run** `node --test test/remote.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** `defineRemoteGame` and the `create` branch in `RoomManager.create` (blocklist check before parsing the definition). Then the snapshot fields, the `configure` guard and the lobby guard.
- [ ] **Step 4: Run** `npm test`. Expected: all pass.
- [ ] **Step 5: Commit:** `Rooms made from a GitHub game source`.

---

### Task 4: RemoteMatch and the relay

**Files:**
- Create: `server/remote-match.js`
- Modify: `shared/protocol.js`, `server/room.js:422-442` (`startMatch`), `server/connection.js` (`#onMessage` size rule, `#route`), `server/server.js:163` (`maxPayload`)
- Test: `test/relay.test.js`

**Interfaces:**
- Produces protocol additions:
  - `C2S.RELAY = 'relay'`: `{ msgs: Item[] }`, from the runner only.
    - Item `{ k:'out', to:'all', except?, type, data }`, or `{ k:'out', to:'team', team, type, data }`, or `{ k:'out', to:'player', id, type, data }`.
    - Item `{ k:'ctx', op:'setStat', args:[playerId, key, value] }`, `{ op:'setTeamScore', args:[team, value] }`, `{ op:'setTeam', args:[playerId, team] }`, `{ op:'announce', args:[text] }`, `{ op:'endMatch', args:[result, opts] }`.
  - `S2C.RELAY_IN = 'relay:in'`: `{ from, type, data }`.
  - `S2C.RELAY_EVENT = 'relay:event'`, with `ev` one of:
    - `'start'`: `{ matchId, settings, game: { id }, startedAt }`
    - `'join'`: `{ id, spectator, virtual, options }`
    - `'leave'`: `{ id }`
    - `'team'`: `{ id, oldTeam }`
    - `'spectate'`: `{ id, spectating }`
    - `'results'`: `{ result }`
    - `'end'`: `{}`
  - `LIMITS.MAX_RELAY_BYTES = 256 * 1024` and `LIMITS.MAX_RELAY_MSGS = 512`.
- Produces `class RemoteMatch` with the same surface `Room` uses on `Match`:
  - Properties `id`, `settings`, `active` (`Set`), `watchers` (`Set`), and `runnerId` (the host's player id at match start).
  - Methods `start()`, `stop()`, `call(name, ...args)` (only `onResults` does anything: it sends `results`), `playerReady(p)`, `playerGone(p)`, `playerSpectateChanged(p)`, `playerTeamChanged(p, oldTeam)`, `message(p, type, data)`.
  - `relay(player, msgs) -> errorCode | null`.
  - `Room.startMatch` picks `RemoteMatch` when `def.source` is set.
- Rules:
  - Only `runnerId` may relay (otherwise `not_runner`).
  - `out` items reach exactly the players `ctx.send`, `ctx.broadcast` and `ctx.sendTeam` would reach in `server/match.js`, serialized once per item.
  - `ctx` items are applied with `room.teamScores` and `room.assignTeam`, and `room.endMatch`'s existing cleaning.
  - `setStat` accepts a key matching `^[A-Za-z0-9_]{1,32}$` and a value that is a finite number or a string of up to 64 characters.
  - `announce` uses a `TokenBucket(1, 5)`.
  - Invalid items are skipped; the rest of the batch still applies.
  - A batch over `MAX_RELAY_MSGS` is refused whole with `relay_too_big`.
  - Connection size rule: messages up to `MAX_MESSAGE_BYTES` as today. A `relay` message may be up to `MAX_RELAY_BYTES`. Anything larger closes with 1009 as today (ws `maxPayload` is `MAX_RELAY_BYTES`).
  - When the runner's player disconnects or leaves, call `room.endMatch({ text: COPY.hostLeft, error: true }, { resultsSeconds: 0 })` on the next microtask.

- [ ] **Step 1: Write the failing tests** in `test/relay.test.js`. A `TestClient` acts as the runner by hand; there is no runner code yet.
  - `the runner hears the match start and each player who loads`: after `room:start` and both players' `match:ready`, the host receives `relay:event start` with the room's settings, then `join` for each player id.
  - `player game messages reach only the runner`: the guest sends `game input {dx:1}`; the host gets `relay:in { from: guestId, type:'input', data:{dx:1} }`; the guest gets nothing back.
  - `relay out reaches the right players`:
    - `to:'all'` reaches both players.
    - `to:'player', id: guestId` reaches only the guest.
    - `to:'all', except: hostId` reaches only the guest.
    - With the `dots` meta (teams), `to:'team', team:'blue'` reaches only blue players.
  - `relay ctx updates the scoreboard`: `setStat [guestId,'points',3]` and `setTeamScore ['red',2]` show in the next room snapshot.
  - `bad relay items are skipped`:
    - `setStat` with key `'a b'` changes nothing.
    - `setTeam` to `'green'` changes nothing.
    - A valid item in the same batch still applies.
  - `only the runner may relay`: the guest's `relay` gives the error `not_runner`.
  - `the runner leaving ends the match with the host-left message`: closing the host socket makes the guest receive `match:end` with `result.text === COPY.hostLeft`. The room stays open with the guest as host.
  - `a relay batch over the item limit is refused`: 513 items give the error `relay_too_big`, and the connection stays open.
  - `a 100 KB relay batch is accepted, and a 100 KB game message is not`: the relay is delivered; the plain `game` message closes the socket with code 1009.
  - `relay traffic counts toward the daily budget`: `srv.server.traffic.bytes` grows by at least the delivered size.
- [ ] **Step 2: Run** `node --test test/relay.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** the protocol additions, `RemoteMatch`, the `startMatch` branch, the connection size rule and the `relay` route (`room.match?.relay?.(player, msg.msgs)`, error `bad_phase` without a remote match).
- [ ] **Step 4: Run** `npm test`. Expected: all pass, `spectate.test.js` included.
- [ ] **Step 5: Commit:** `RemoteMatch: the server relays a host-run game`.

---

### Task 5: Lobby bots in remote rooms

**Files:**
- Create: `server/bots/virtual.js`
- Modify: `server/bots/manager.js` (export `pickBotName`), `server/room.js` (`get bots()`, used everywhere `this.owner.bots` is today), `server/remote-match.js` (start marks bots loaded)
- Test: add to `test/relay.test.js`

**Interfaces:**
- Produces `pickBotName(room, tickets = new Map()) -> string`, moved out of `BotManager.pickName`, with the same behaviour. `BotManager.pickName` calls it.
- Produces `class VirtualConn`, the no-op stand-in for `Connection` used by bots the runner controls: `ip = 'virtual'`, `closed = false`, `bind`, `unbind`, `detach`, `send`, `sendRaw`, `sendGame`, `close`.
- Produces `class VirtualBots`, constructed with `(room)`: `hasBrain() -> room.def.hasBot`, `spawn(room, { team, difficulty, filler }) -> Promise<Player>`, `pending() -> {}`. `spawn` adds the player synchronously through `room.addPlayer(pickBotName(room), new VirtualConn(), { bot: true, team })`, sets `filler` and `difficulty`, and calls `room.playerLoaded(p)` when a match is running.
- `Room` gets `get bots()`: `VirtualBots` for remote games, else `this.owner.bots`.
- `join` events carry `virtual: true` and `options: { difficulty }` for these bots. External bots joining over WebSocket stay `virtual: false`.

- [ ] **Step 1: Write the failing tests:**
  - `a remote room's host adds bots that need no socket`: with `hasBot: true` in the meta, `room:bots { add: 2 }` gives two bot players with `connected: true`, and `srv.server.wss.clients.size` is unchanged.
  - `bots in a remote room join the match as virtual players`: after start, the host receives `join` events for both bots with `virtual: true`.
  - `remote auto-fill tops teams up with virtual bots`: for the `dots` meta with `autoFill: { perTeam: 2 }`, starting with one human gives 3 bots.
  - `without hasBot, bots are refused`: the error is `no_bots`.
  - `bots alone never keep a remote room open`: the host leaving closes the room.
- [ ] **Step 2: Run** `node --test test/relay.test.js`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** it.
- [ ] **Step 4: Run** `npm test`. Expected: all pass, `bots.test.js` included.
- [ ] **Step 5: Commit:** `Lobby bots in remote rooms are players the host's runner controls`.

---

### Task 6: The game runner core

Environment-neutral, so Node tests can drive it against the real server.

**Files:**
- Create: `client/frame/runner-core.js`
- Modify: `test/helpers.js` (add `TestClient.onMessage(fn)` and `relayHost`), `test/remote.test.js` (use `describeGame`)
- Test: `test/runner.test.js`

**Interfaces:**
- Consumes: the protocol from Task 4, `KIT_VERSION` from Task 2, `COPY`.
- Produces in `client/frame/runner-core.js`. It imports only `../../shared/protocol.js` and `../../shared/copy.js`, by relative path:
  - `describeGame(def, { hasBot }) -> meta`: plain JSON of every `defineGame` field except `create`, plus `hasBot`.
  - `createRunner({ def, transport, loadBrain, timers, now, log }) -> { receive(msg), stop(), hooks, ctx }`. `hooks` is the object `def.create` returned (empty before `start`), so tests can call `debugState`.
    - `transport.send(msg)` takes one `{ t: C2S.RELAY, msgs }` per flush.
    - `loadBrain(gameId) -> Promise<brain | null>`.
    - `timers` defaults to `{ setInterval, clearInterval }`, and `now` to `() => performance.now()`.
    - `receive` takes server messages: `room` (snapshot), `relay:event` and `relay:in`.
- Behaviour:
  - `start` builds `ctx` and calls `def.create(ctx)`. It ticks at `def.tickRate`, with `dt` capped at 0.25 s, as `server/match.js` does.
  - Player views are one live object per id. Getters read the latest snapshot for `name`, `team`, `ping`, `connected`, `bot` and `spectating`, and the runner's own `stats`.
  - Hook errors are counted as `Match.call` counts them. At 25, the runner sends `endMatch` with `COPY.gameCrashed(...)` and `error: true`. A throw in `create()` ends the match at once the same way.
  - Sends are queued and flushed once per microtask. A flush whose JSON is over `LIMITS.MAX_RELAY_BYTES`, or that has more than `MAX_RELAY_MSGS` items, is dropped, and the runner sends one `endMatch` with `COPY.gameTooChatty` instead.
  - `addStat` and `addTeamScore` are computed locally and sent as `setStat` and `setTeamScore`.
  - Virtual bots: on `join` with `virtual: true`, the runner mounts the brain with the same `api` names as `BotClient#api` in `server/bots/client.js`.
    - `api.send` calls the game's `onMessage` locally.
    - Messages to that bot from `ctx.send`, `broadcast` and `sendTeam` are delivered locally; their relay copies still go out, and the server drops them harmlessly.
    - `chat` does nothing, and `rtt()` returns 0.
  - `end` stops the ticks, calls `onEnd`, and destroys the brains.
- Produces `relayHost(srv, { gameDir, password = '' }) -> Promise<{ host, runner, roomId, hostId }>` in `test/helpers.js`. It imports `<gameDir>/server.js` and, if present, `bot.js`. It creates the room with `source` and `describeGame`, and wires every `room`, `relay:event` and `relay:in` message into `runner.receive`.

- [ ] **Step 1: Write the failing tests** in `test/runner.test.js`. Each runs against `startServer()` with `relayHost` and `templates/starter`, unless it says otherwise.
  - `the starter runs end to end through the relay`: a guest joins, both get `match:ready`, and the guest sends `input {dx:1,dy:0}`. Within 1 s the guest receives `state` whose entry for the guest has `x` increasing.
  - `stats and scores set by the game reach the scoreboard` (with the `solo` fixture): the game's `setStat` shows in the snapshot's `stats`, and `endMatch` gives `match:end` with that winner.
  - `a game that throws in create ends the match with the crash message`: for a temp game whose `create` throws `new Error('boom')`, `match:end` gives `result.error === true` and `result.text === COPY.gameCrashed('boom')`.
  - `a game that throws every tick is stopped after 25 errors`.
  - `a game that sends too much in one tick ends cleanly`: a temp game broadcasts 300 KB once. The guest gets `match:end` with `COPY.gameTooChatty`, and both sockets stay open.
  - `virtual bots move in a remote dots room` (with the `dots` fixture and its `bot.js`): after `room:bots { add: 1 }` and start, the bot's position in `debugState` moves more than 3 units in 1.5 s. `debugState` is reached through the runner's hooks.
  - `spectators are invisible to the game`: a guest who picks `spectate` before the start never appears in `ctx.players()`, and is in `ctx.spectators()`.
  - `a player joining mid-match is seen by the game` (with `joinInProgress` true): a third client joining during play receives `state` that includes it.
- [ ] **Step 2: Run** `node --test test/runner.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** `runner-core.js`, `relayHost` and `TestClient.onMessage`. Switch `test/remote.test.js` to `describeGame`.
- [ ] **Step 4: Run** `npm test`. Expected: all pass.
- [ ] **Step 5: Commit:** `Game runner: ctx in the host's browser, tested against the real server`.

---

### Task 7: The frame page and its boot script

**Files:**
- Create: `server/frame.js`, `client/frame/boot.js`, `client/frame/game-api.js`
- Modify: `server/server.js` (route `/frame/` to `renderFrame`)
- Test: `test/frame.test.js`

**Interfaces:**
- Consumes: `refBase`, `parseRef`; `createRunner` and `describeGame`; `KIT_VERSION`; **RUNNER_LOCATION** from Task 1.
- Produces `renderFrame(req, config, { cdn, three }) -> { headers, body }`. `GET /frame/?src=<ref>&parent=<origin>` returns HTML with:
  - A nonce'd import map. Its `imports` maps `three` to `${three}build/three.module.js` and `three/addons/` to `${three}examples/jsm/`. Its `scopes[refBase]` maps `<cdn origin>/client/` to `refBase + 'client/'`, and `<cdn origin>/shared/` to `refBase + 'shared/'`.
  - `<script type="module" src="/frame/boot.js">`.
  - These headers:
    - `Content-Security-Policy: sandbox allow-scripts allow-pointer-lock; default-src 'none'; script-src <play origin>/frame/ <cdn origin> 'nonce-…'; style-src 'unsafe-inline' <cdn origin>; img-src <cdn origin> data: blob:; media-src <cdn origin> data: blob:; font-src <cdn origin>; connect-src <cdn origin>; worker-src blob:; frame-ancestors 'self'`. Adjust it to what Task 1 recorded.
    - No `X-Frame-Options`.
  - A `src` that fails `parseRef` returns 400. A blocked repo returns 403 with `COPY.blocked`.
- Produces the frame and parent message protocol, every message `{ fs: 1, kind, ... }`:
  - Frame to parent: `ready`, `meta { meta, kitVersion }` (inspect role), `error { text }`, `send { type, data }`, `relay { msgs }`, `pickTeam { team }`, `ui { action }` (`openMenu`, `openTeamPicker`, `showScorebar`, `showHint`), `toast { text, kind }`, `key { type: 'down'|'up', code }` for `Tab`, `Enter`, `NumpadEnter` and `Escape`.
  - Parent to frame: `init { role: 'inspect'|'player'|'host', src, me, room, chat, serverOffset }`, `room { room }`, `game { type, data }`, `server { msg }` (host role: `relay:event` and `relay:in`), `ui { blocking, event: 'block'|'resume' }`, `matchEnd { result }`, `destroy`.
- `boot.js` behaviour:
  - It accepts messages only from `window.parent`, with `event.origin` equal to the `parent` query value, and posts to that origin.
  - `inspect`: it imports `refBase + 'server/kit/index.js'` and reads `KIT_VERSION`. If that is missing or below 1, it sends `error` with `COPY.forkTooOld`. Otherwise it imports `<path>/server.js`, checks for `<path>/bot.js` by `fetch`, and sends `meta`.
  - `player`: it builds `api` with `createGameApi(bridge)`, imports `<path>/client/index.js`, and mounts into `#root` and `#hud`.
  - `host`: it does the same as `player`, and also starts the runner, in a blob module worker or on the main thread according to RUNNER_LOCATION.
- Produces `createGameApi(bridge) -> api` in `client/frame/game-api.js`. It has every field of the `api` object in `client/js/screens/match.js:250-315`, with the same meaning, backed by the mirrored snapshot and `postMessage`. `canPickTeam` uses the same rule as `client/js/components.js:17`.

- [ ] **Step 1: Write the failing tests** in `test/frame.test.js` (HTTP only):
  - `the frame page pins the game's commit in its import map`: GET `/frame/?src=<ref>&parent=http://127.0.0.1:<port>` gives 200. The parsed import map's `scopes` has `refBase` as a key, mapping the CDN's `/client/` to `refBase + 'client/'`.
  - `the frame page is sandboxed by header`: the CSP starts with `sandbox allow-scripts allow-pointer-lock`, `script-src` includes the nonce found in the body, and there is no `x-frame-options` header.
  - `bad and blocked sources get no frame`: 400 for `src=gh:nope`, and 403 for a blocklisted repo.
  - `frame scripts are served with CORS`: GET `/frame/boot.js` has `access-control-allow-origin: *`.
- [ ] **Step 2: Run** `node --test test/frame.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** `renderFrame`, `boot.js` and `game-api.js`.
- [ ] **Step 4: Run** `npm test`. Expected: all pass.
- [ ] **Step 5: Commit:** `The game frame: sandboxed page, import map pinned to the commit, boot script`.

---

### Task 8: The friendslop page hosts the frame (match screen, banner, first-look screen)

**Files:**
- Create: `client/js/frame-host.js`, `client/js/unreviewed.js`
- Modify: `client/js/screens/match.js:317-349` (a remote game mounts through `frame-host`; server games keep the `import()` path), `client/css/style.css` (banner and first-look screen)

**Interfaces:**
- Consumes: the frame protocol (Task 7), `COPY`, `parseRef`, `repoKey`, `store.hello.remote`.
- Produces `mountGameFrame({ net, store, role, src, container, overlay }) -> { destroy() }`.
  - `overlay` is `{ onKey(type, code), openMenu, openTeamPicker, showScorebar, showHint, isBlocking, onUi(fn) }`, which `match.js` builds from its existing functions.
  - It creates `<iframe sandbox="allow-scripts allow-pointer-lock" allow="fullscreen; autoplay; gamepad" src="/frame/?src=…&parent=…">`.
  - It forwards in both directions as described in Task 7. Only messages whose `event.source` is this frame's `contentWindow` are accepted.
  - On the host it sends `relay:event` and `relay:in` messages from `net` to the frame, and the frame's `relay` messages to `net.send(C2S.RELAY, { msgs })`.
  - A second iframe `load` removes the frame and shows `COPY.gameLeftFriendslop` with a Leave button.
- Produces `confirmFirstLook(repo) -> Promise<boolean>`. It shows `COPY.firstLook` once per repo key, resolves `true` at once if the key was already accepted, and remembers a yes in `localStorage` (`fs.firstLook.<repo>`, wrapped in try/catch). The caller decides what a no means: `match.js` leaves the room, and the Task 9 host form just cancels.
- Produces `unreviewedBanner({ repo, maker, reportUrl }) -> HTMLElement`. It has the banner text, a link to `https://github.com/<repo>`, and a Report link to `${reportUrl}?title=…&body=…` (title `Report: <repo>@<short commit>`), opening in a new tab. It also shows `COPY.hostCanCheat` as a second line.

- [ ] **Step 1: Write the test.** These are browser-only behaviours, so the test is a scripted check in the built-in browser.
  1. Start `DEV_CDN=1 npm run play` in the background.
  2. Open two tabs on `http://localhost:8080`.
  3. Tab A hosts the dev starter (Task 9's dev button, or a `room:create` sent from the console with the dev ref until Task 9 lands), and tab B joins.
  4. Assertions, read with `javascript_tool` and screenshots:
     - The first-look screen shows once per tab and not after reload.
     - The banner shows the repo and a Report link.
     - Both tabs' canvases show two dots, and WASD in tab A moves A's dot in tab B.
     - Esc opens the menu while the frame has focus.
     - Closing tab A shows tab B `COPY.hostLeft` and the lobby.
     - With tab A in the background for 20 s, B's view of A's bot keeps moving smoothly.
- [ ] **Step 2: Run it.** Expected before the implementation: the match screen fails to load the game.
- [ ] **Step 3: Implement** `frame-host.js`, `unreviewed.js` and the `match.js` branch.
- [ ] **Step 4: Run the browser check again.** Expected: every assertion holds. Then `npm test`. Expected: all pass.
- [ ] **Step 5: Commit:** `The match screen runs GitHub games in a sandboxed frame, with the banner and first look`.

---

### Task 9: Hosting from a pasted link

**Files:**
- Create: `client/js/github.js`
- Modify: `client/js/screens/home.js` (a "Host a game from GitHub" form on the create tab, shown always; the empty-games message points at it), `client/js/app.js:38` (`?host=<github url>` prefills that form)
- Test: add to `test/gameref.test.js` (resolver, with a stubbed `fetch`)

**Interfaces:**
- Consumes: `parseGithubUrl`, `formatRef`; `mountGameFrame` with `role: 'inspect'`.
- Produces `resolveCommit({ user, repo, rev }, { api, fetch = globalThis.fetch }) -> Promise<{ commit } | { error }>`.
  - A 40-hex `rev` is returned without a request.
  - Otherwise it calls `GET ${api}/repos/${user}/${repo}/commits/${encodeURIComponent(rev)}` with `Accept: application/vnd.github.sha` and reads the body as the commit.
  - Errors: `not_found` (404 or 422), `rate_limited` (403 or 429), and `network`.
- Produces `inspectGame(src, { container }) -> Promise<{ meta } | { error }>`. It runs a hidden inspect frame, resolves on `meta` or `error`, and gives up after 15 s with `COPY.badLink('timeout')`.
- The flow on submit: `parseGithubUrl`, then `resolveCommit`, then `formatRef`, then `confirmFirstLook`, then `inspectGame`, then `net.send(C2S.CREATE, { name, password, source, def: meta })`. Each failure shows `COPY.badLink(reason)` under the field.
- With `hello.remote.dev`, a "Try the starter" button hosts `gh:local/friendslop@<40 zeros>/templates/starter`.

- [ ] **Step 1: Write the failing tests:**
  - `resolveCommit returns a pasted commit without asking GitHub`: the stubbed `fetch` is never called.
  - `resolveCommit reads the commit for a branch`: the stub returns 200 with a 40-hex body, the result is `{ commit }`, and the requested URL ends with `/commits/feature%2Fx`.
  - `resolveCommit explains failures`: 404 gives `not_found`, 403 gives `rate_limited`, and a thrown error gives `network`.
- [ ] **Step 2: Run** `node --test test/gameref.test.js`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** `github.js`, the home form, the dev button and `?host=`.
- [ ] **Step 4: Run** `npm test`. Expected: all pass. Then the browser check: with `DEV_CDN=1`, "Try the starter" reaches the lobby, and Start reaches a moving dot. A pasted `https://github.com/a/b` shows the "no game folder" message. A made-up repo URL shows the not-found message. (The real GitHub API answers 404 for it, which is fine to call.)
- [ ] **Step 5: Commit:** `Host a game by pasting its GitHub link`.

---

### Task 10: Docs, the public server config, and the site copy

**Files:**
- Modify: `README.md`, `docs/making-a-game.md`, `render.yaml`, `templates/starter/server.js` (comment only), `D:\dev\friendslop-site\index.html:115`, `D:\dev\friendslop-site\bots\index.html:76-78`, and the friendslop-site homepage (a paste-a-link form that redirects to `https://play.friendslop.us/?host=<url>`)

- [ ] **Step 1: Write the docs:**
  - **`docs/making-a-game.md`:**
    - A "Share it with a link" section: fork, push, paste the folder link.
    - Asset URLs: `new URL('../assets/x.png', import.meta.url)` replaces `/games/<id>/assets/...`.
    - `server.js` and `bot.js` use relative imports only.
    - What the fence stops and what it doesn't, in the spec's words: the IP address, and a game can show anything.
    - The host can change scores.
  - **`README.md`:** the hosting section describes instant links and the relay; the config table adds the Task 2 variables; the tests paragraph mentions the relay and runner; the security bullets add the frame and its limits.
  - **`render.yaml`:** drop `GAMES_DIR`, because the public server runs no game code.
- [ ] **Step 2: Rewrite the two site lines** that stop being true, in the jokey voice, with the honest version:
  - `friendslop-site/index.html`, the "The server keeps score" item.
  - `friendslop-site/bots/index.html`, the "One door for everyone" paragraph.
  - Add the paste-a-link form to the site homepage.
  - Commit in `D:\dev\friendslop-site` locally (`git -c safe.directory=D:/dev/friendslop-site …`). Do not push: that repo goes live on push.
- [ ] **Step 3: Check for dashes:** `LC_ALL=C.UTF-8 grep -n "—\|–"` over every changed doc, site file and `shared/copy.js`. Expected: no matches.
- [ ] **Step 4: Run** `npm test` and the Task 8 browser check once more. Expected: all pass.
- [ ] **Step 5: Commit** in `D:\dev\friendslop`: `Docs and config for instant game links`.
- [ ] **Step 6: Show Josh the wording.** Show every changed player-facing string (`shared/copy.js`, both site lines, the docs' disclosure paragraphs) as one list, and ask him to approve or rewrite. Nothing is published until he does.

---

## Spike results

(Task 1 fills this in. RUNNER_LOCATION: TBD.)
