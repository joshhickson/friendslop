# friendslop

A kit for vibecoding small, chaotic multiplayer games and playing them with your friends tonight.

**Status: pre-alpha. Code lands here soon.** Teaser: [friendslop.us](https://friendslop.us)

## What it's for

The boring parts of a multiplayer game, done once, so every new idea starts at the fun part:

- **Rooms with a code and a password.** Send the code to the group chat, keep the randoms out.
- **A lobby where the host runs the show.** Pick teams, see who's in, start the match.
- **Game modes that snap in.** Each game is an add-on to the same foundation.
- **Bots that join like players.** They fill empty slots, and they connect the same way people do, so your own code can drive one.
- **Host from your own PC.** Share a link and friends join from anywhere, with no router settings to touch.
- **Runs in a browser.** Your friends click a link. Nobody installs anything.

## First modes

- Capture the flag, in first person
- Control points

## Languages

**The alpha is mostly JavaScript, with a bit of [ws](https://github.com/websockets/ws) for WebSockets:** a Node.js server and a browser client. It's a proof of concept, picked because it's quick to build and runs everywhere.

**friendslop isn't tied to JavaScript.** The plan is a documented network protocol for rooms, the lobby, game state, player input and bots. Anything that speaks it can join a room, whatever it's written in:

- other server implementations
- other clients, such as a Rust/WebAssembly client for fast loads on phones
- bots in any language, from a short Python script to an AI agent

Expect the JavaScript parts to be rewritten or joined by others as the project grows.

## License

[Apache-2.0](LICENSE). Use it, change it, and ship games with it, including commercial ones.
