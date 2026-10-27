# friendslop

A kit for vibecoding small, chaotic multiplayer games and playing them with your friends tonight.
One central Node server, WebSockets, rooms with a code and password, a lobby with teams, bots,
and a browser client. Games are drop-in folders.

**Status: alpha.** Teaser and roadmap: [friendslop.us](https://friendslop.us)

**No games are included yet.** The alpha is the framework: rooms, the lobby, teams, bots, spectating
and hosting. You bring the game. `npm run new-game` starts you from a template where everyone is a dot
that walks around, and you add the rules.

## Quick start

Requires Node.js 20+.

```sh
npm run new-game -- my-game "My Game"   # copies the starter template to games/my-game/
npm run play                            # starts the server and opens your browser
```

On first run `npm run play` installs dependencies, starts the server, and opens
`http://localhost:8080` in your browser.

If you'd rather open the browser yourself, use `npm start` and go to **http://localhost:8080**.
For friends on other networks, use `npm run tunnel` (see [below](#playing-with-friends-on-other-networks)).

**Testing multiplayer on one PC:** open the address in two browser windows, or one normal and one private window.
Each tab is a separate player.

1. Window 1: enter a name, optionally a password, then **Create room**. You're the host.
2. Window 2: enter a name, then **Join room** with the 6-letter code and the password.
3. If the game has teams, pick one by clicking a team column. The host presses **Start match**.

**Spectating:** click **Spectate instead** in the lobby, or pick **Spectate** from the team picker or the
Esc menu. Spectators see everything the game broadcasts and can join a team at any time.

### Bots

For games that have a `bot.js`, the host's **Bots** panel in the lobby adds any number of bots, to a chosen team or balanced, at
easy, normal or hard. Remove one with its **remove** button, or all at once. The starter template
comes with a bot that wanders around.
Bots are real player connections that go through the normal join path, run entirely on your machine,
and don't call any outside service. They never become host, and a room closes when its last human leaves.

To run bots from a separate program (or another computer), use the room code and password like a person would:

```sh
npm run bot -- --room ABC123 --password pizza --count 2 --difficulty hard
```

See [docs/making-a-game.md](docs/making-a-game.md#botjs-optional) to write a bot for your game, or to
drive a player from your own code.

## Security and networking

**The default is local-only.** The server binds to `127.0.0.1`, so no other computer
can connect. Nothing is exposed on your network or the internet, and nothing is
port-forwarded. Players never connect to each other, only to the central server, so
friends' IPs are never shared.

Other protections in place:

- Room passwords are hashed with scrypt. Wrong guesses are rate-limited per IP and per room, with a temporary lockout.
- WebSocket connections are only accepted from the game's own page (Origin check), so other websites you visit can't connect through your browser.
- The Host header is allowlisted, which blocks DNS-rebinding attacks.
- A strict Content-Security-Policy is set, plus `nosniff` and no framing.
- Message size limits, per-connection rate limits, per-IP connection caps, and room/creation caps.
- Only `client/`, `shared/` and each game's `client/`, `shared/`, `assets/` folders are served. Game `server.js` files and `server/` are never exposed.
- All client messages are validated. Games keep the server in charge of state and score, and the starter template shows how.

### Playing with friends on other networks

```sh
npm run tunnel
```

This prints a public `https://<random-words>.trycloudflare.com` address. Send that plus the
room password to your friends. It uses a Cloudflare **quick tunnel**:

- **No account and no setup.** The first run downloads `cloudflared` into `.tools/` (gitignored) and checks it against a pinned SHA-256 before running it.
  An existing `cloudflared` on your PATH, or one pointed to by `CLOUDFLARED=…`, is used instead.
- **Your PC stays closed.** `cloudflared` only makes outbound connections to Cloudflare, and the game server still
  only listens on `127.0.0.1`. No ports are opened or forwarded and no router or firewall changes are needed.
  Friends connect to Cloudflare and never see your IP, and you never see theirs.
- **HTTPS/WSS end-to-end** to Cloudflare, with the same Host/Origin/CSP protections as local play. Only that
  run's tunnel hostname is added to the allowlist.
- **Rate limits use each player's real IP** (Cloudflare's `Cf-Connecting-Ip`, trusted only on connections from the local tunnel).
- **For testing only:** the URL changes every run, stops when you press Ctrl+C, and has no uptime guarantee.
  For a permanent address, use a named Cloudflare tunnel (free account) or a VPS:
  `ALLOWED_HOSTS=yourgame.example.com TRUST_CLOUDFLARE=1 npm start` behind your own tunnel.

Anyone with the URL can reach the home screen, so give rooms a password when playing over the tunnel.

### Hosting it for everyone

`render.yaml` sets up one always-reachable server on [Render](https://render.com)'s free plan, so
anyone can host a room just by visiting the site. In Render, choose **New > Blueprint** and pick this
repo. It installs with `npm ci`, starts `node server/start.js`, and sets the public-server limits
below. Point a CNAME for your domain at the service's `onrender.com` name and list both names in
`ALLOWED_HOSTS`.

- **The free plan sleeps** after 15 minutes without visitors. The first visitor after that waits
  about a minute while it wakes. A restart ends every room in progress.
- **Rate limits use the first address in `X-Forwarded-For`** (`TRUST_PROXY=1`). On its first player
  connection the server logs which client-address headers the proxy sent, by name and count only.
- **Free bandwidth is capped,** so `DAILY_TRAFFIC_MB` stops new rooms and matches once the day's
  budget is used. Running matches finish, and the budget resets at midnight UTC.
  `/api/health` shows the day's total.
- **Forgotten tabs don't stream all night:** `ROOM_IDLE_MS` closes a room when no human in it has
  sent anything for that long.
- **It serves `templates/`** (the starter) until `GAMES_DIR` points at a folder with real games.

### Configuration

All settings are environment variables (or `--port`, `--host`, `--open` flags).

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8080` | HTTP/WebSocket port |
| `HOST` | `127.0.0.1` | Bind address. Leave it alone unless you know you want LAN access. |
| `ALLOWED_HOSTS` | (none) | Extra hostnames accepted in the `Host` header (e.g. a tunnel domain) |
| `ALLOWED_ORIGINS` | (none) | Extra origins allowed to open WebSockets |
| `TRUST_PROXY` | off | `1` = use `X-Forwarded-For` for rate limiting (only behind your own proxy) |
| `TUNNEL` | off | `1` = same as `--tunnel` (Cloudflare quick tunnel, public URL) |
| `TRUST_CLOUDFLARE` | off | `1` = use `Cf-Connecting-Ip` from local connections (on automatically with `--tunnel`) |
| `CLOUDFLARED` | (auto) | path to a `cloudflared` binary to use instead of downloading one |
| `GAMES_DIR` | `games/` | Folder the games are loaded from |
| `DEFAULT_GAME` | (first game) | Game preselected on the home screen |
| `MAX_ROOMS` | `100` | |
| `MAX_PLAYERS_PER_ROOM` | `20` | Also capped by each game's `maxPlayers` |
| `MAX_CONNECTIONS_PER_IP` | `32` | WebSocket connections from one address |
| `MAX_CONNECTIONS` | `500` | Player connections to the whole server (the server's own bots don't count) |
| `ROOM_CREATES_PER_MINUTE` | `10` | Rooms one address may create per minute |
| `RECONNECT_GRACE_MS` | `20000` | How long a dropped player keeps their seat |
| `ROOM_IDLE_MS` | `0` (off) | Close a room when no human in it has sent anything for this long |
| `DAILY_TRAFFIC_MB` | `0` (off) | Data the server may send to players per UTC day before it refuses new rooms and matches |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error`, `silent` |

## Making games

```sh
npm run new-game -- my-game "My Game"
npm run dev        # restarts the server when server-side files change; refresh the browser for client changes
```

See **[docs/making-a-game.md](docs/making-a-game.md)** for the full guide and API.

In short, a game is a folder:

```
games/my-game/
  server.js          export default defineGame({...})  - rules, authoritative state
  client/index.js    export default defineClientGame({ mount(api) {...} })  - rendering + input
  bot.js             optional: what bots do
  shared/            optional: code/data used by both (maps, constants)
  assets/            optional: images, sounds, models
```

The framework handles rooms, passwords, host, lobby, teams, team scores, per-player stats,
the scoreboard, chat, match start/end, reconnects and the pause menu. Your game only
handles what's unique to it.

## Project layout

```
server/            Node server: HTTP + WebSocket, rooms, matches, security
  kit/             what game server code imports (defineGame + helpers)
  bots/            BotClient (a player over WebSocket) + lobby bot manager
client/            Browser app: home, lobby, in-match overlay
  kit/             what game client code imports (input, sound, three.js helpers)
shared/            protocol + helpers used on both sides (math, physics, pathfinding, history, timers)
games/             one folder per game (starts empty)
templates/starter/ what `npm run new-game` copies
scripts/           new-game scaffolder, standalone bot runner
test/              node:test suites, run with `npm test`
  fixtures/games/  two tiny games that exist only for the tests
render.yaml        one public server on Render's free plan
```

## Tests

```sh
npm test
```

Spins up real servers on random ports and drives them with scripted WebSocket clients.
Covers rooms, passwords, lockouts, host powers, teams, reconnects, origin checks, match endings,
spectating and team locks, bots (adding and removing, tickets, external bots, pathfinding),
a server with no games, the starter template, and the public-server limits.

## Languages

**The alpha is mostly JavaScript, with a bit of [ws](https://github.com/websockets/ws) for WebSockets:** a Node.js server and a browser client, with [three.js](https://threejs.org) for 3D. It's a proof of concept, picked because it's quick to build and runs everywhere.

**friendslop isn't tied to JavaScript.** The network protocol already lives in one shared module, and the plan is to document it for rooms, the lobby, game state, player input and bots. Anything that speaks it can join a room, whatever it's written in:

- other server implementations
- other clients, such as a Rust/WebAssembly client for fast loads on phones
- bots in any language, from a short Python script to an AI agent

Expect the JavaScript parts to be rewritten or joined by others as the project grows.

## License

[Apache-2.0](LICENSE). Use it, change it, and ship games with it, including commercial ones.
