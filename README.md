# friendslop

A kit for vibecoding small, chaotic multiplayer games and playing them with your friends tonight.

**Status: alpha, in testing. The code lands here soon.** Teaser: [friendslop.us](https://friendslop.us)

## What it's for

The boring parts of a multiplayer game, done once, so every new idea starts at the fun part:

- **Rooms with a code and a password.** Send the code to the group chat, keep the randoms out.
- **A lobby where the host runs the show.** Pick teams, see who's in, start the match.
- **Game modes that snap in.** Each game is a folder dropped into the same foundation.
- **Bots that join like players.** They fill empty slots, and they connect the same way people do, so your own code can drive one.
- **Host from your own PC.** Share a link and friends join from anywhere, with no router settings to touch.
- **Runs in a browser.** Your friends click a link. Nobody installs anything.

## What the alpha has so far

- **One command** starts the server and opens the game in your browser.
- **Local-only by default.** Nothing is reachable from other computers until you choose to share a link.
- **Rooms, passwords, a lobby with teams and scores**, host controls, chat, a scoreboard and reconnects, handled by the framework.
- **The server is in charge** of health, hits, flags and score, so clients can't cheat their way to a win.
- **Capture the flag:** a low-poly, first-person shooter on one map. Shoot, take hits, respawn, capture flags.
- **A tiny 2D demo game** that doubles as the template for new games.
- **A new-game script and a how-to guide**, so the next game starts from a working folder.
- **Automated tests** that drive real servers with scripted players.

In the works: bots, a respawn wait with spectating, and a second mode, Control points.

## How it's laid out

```
server/   the Node server: rooms, matches, connections
client/   the browser app: home screen, lobby, in-match overlay
shared/   code both sides use, including the network protocol
games/    one folder per game, each with its own server and client code
```

A game only handles what's unique to it. The framework does the rest.

## Languages

**The alpha is mostly JavaScript, with a bit of [ws](https://github.com/websockets/ws) for WebSockets:** a Node.js server and a browser client, with [three.js](https://threejs.org) for 3D. It's a proof of concept, picked because it's quick to build and runs everywhere.

**friendslop isn't tied to JavaScript.** The network protocol already lives in one shared module, and the plan is to document it for rooms, the lobby, game state, player input and bots. Anything that speaks it can join a room, whatever it's written in:

- other server implementations
- other clients, such as a Rust/WebAssembly client for fast loads on phones
- bots in any language, from a short Python script to an AI agent

Expect the JavaScript parts to be rewritten or joined by others as the project grows.

## License

[Apache-2.0](LICENSE). Use it, change it, and ship games with it, including commercial ones.
