# Retro games in the browser, each player with their own copy

Research, 2026-10-31. Nothing here is decided or built. It follows
[the Quiver research](2026-10-31-quiver-games-multiplayer.md): streaming video was ruled out because
of the lag, and asked about emulators instead.

## The idea

Every player's browser runs the same open-source emulator, loaded from jsDelivr like any friendslop
game. Each player picks their own copy of the game file from their own computer. It never leaves
their computer, and friendslop never stores or sends it. friendslop's room connects the players, and
the only thing that travels is controller input.

## How it would work

1. **Same game, checked without sharing it.** In the lobby each browser works out a fingerprint (a
   hash) of its file, and the room compares fingerprints. Everyone needs the exact same version of the
   game, so a mismatch is caught before the match, without anyone's file being sent.
2. **Same emulator.** The emulator is pinned to one commit, the way friendslop games already are, so
   every browser runs identical code with identical settings.
3. **Lockstep.** Every frame, each browser sends its player's buttons to the others. A browser only
   runs frame 100 once it has everyone's input for frame 100. To keep that from stalling, each input
   is scheduled a few frames ahead (input delay), so it has time to arrive. This is how Dolphin and
   the N64 netplay tools work.
4. **Rollback, later.** Instead of waiting, a browser guesses the other players' input, runs ahead,
   and when the real input arrives it rewinds to a saved copy of the game's memory and replays. That
   hides most of the lag. It needs a memory snapshot every frame, which is cheap for small consoles
   and too heavy for big ones (below).
5. **Desync check.** Every so often the browsers compare a fingerprint of the game's memory. If two
   ever differ, the match stops with a clear message instead of carrying on with two different games.

## Lag

- Lockstep tools suggest 1 to 4 frames of input delay. Rollback stays responsive up to roughly 50 to
  100 ms of ping. For comparison, streaming video adds encoding, buffering and the trip back on top.
- **Where the input travels matters most.** Today a player's game message goes to the server, then to
  the host's browser, then back through the server to everyone else. For lockstep that doubles the
  trip. Two ways to fix it:
  - the server sends each player's input straight to every other player (a small change in
    `server/remote-match.js`);
  - or players connect to each other directly over WebRTC, which the
    [hosting research](2026-10-28-hosting-options.md) already recommends looking at.
- **It's almost free for our server.** Input is a few bytes a frame. A rough estimate is 30 to 100
  kbit/s per player link, before packing, against megabits for video. Compared with Control Points'
  snapshots it's tiny, so the daily budget would cover a lot of play.

## Which consoles

| Console | Rollback in a browser? | Why |
|---|---|---|
| NES, Game Boy, GBA, Genesis, SNES | Likely | Memory snapshots are small: about 400 KB for GBA and 1 MB for Genesis. One WebAssembly Genesis emulator rolls back 8 frames at 1.5 ms a step |
| N64, PS1 | Lockstep only | An N64 snapshot is about 17 MB, too much to take every frame |

Start with the small consoles.

## What exists, and what's missing

- **EmulatorJS** (GPL-3.0) is the most complete browser emulator, with 49 cores served from jsDelivr.
  But its multiplayer streams the host's screen as video, the approach ruled out above, and only the
  host needs the game.
- **Nostalgist.js** (MIT) wraps the same emulators and loads them from jsDelivr. It can save and load
  state, but it can't step exactly one frame or set each player's input for a frame, so lockstep would
  mean working around it.
- **RetroArch's web build** has no multiplayer. Its desktop multiplayer uses a network connection
  browsers can't open.
- **Small projects that do the right thing:** kaillera-next (N64, GPL-3.0, each player drops their own
  game file, rollback over WebRTC) is the closest, but it patches the emulator, needs a browser
  feature friendslop's sandboxed frame probably can't get (SharedArrayBuffer), and has open desync
  bugs. NetplayJS (ISC) is a general rollback and lockstep library over WebRTC.

So nothing does this off the shelf for the common consoles. The piece to build is small but exact: a
little JavaScript driver that runs an emulator core one frame at a time, gives it each player's input
for that frame, and saves and loads its memory. Emulator cores already have exactly those three
functions (libretro's `retro_run`, its input callback, and `retro_serialize`). The browser wrappers
just don't expose them.

## What friendslop would need

- **WebAssembly allowed in the game frame.** The frame's security rules don't allow compiling
  WebAssembly today. Adding `'wasm-unsafe-eval'` to its `script-src` (in `server/frame.js`) allows
  WebAssembly without allowing JavaScript `eval`.
- **Input sent straight to every player,** as above.
- **Remembering a player's game file,** optionally. The sandboxed frame can't store anything, so
  without help a player picks the file again every time. The friendslop page could keep it in the
  player's own browser storage and hand it to the frame. It would still never leave their computer.
- **Emulator builds without threads.** Threaded builds need SharedArrayBuffer, which the sandboxed
  frame probably can't get. EmulatorJS publishes "legacy" builds without threads.
- Gamepads already work in the frame, and 60 inputs a second fits the server's per-player limit
  (`server/connection.js`, 120 a second).

## Licences and the law

- **Emulator cores have their own licences.** snes9x, Genesis Plus GX and PicoDrive forbid commercial
  use, which is fine while friendslop is free but would matter if that ever changed. fceumm, Nestopia
  and gambatte are GPL-2.0, and mGBA is MPL-2.0, so a game that bundles one takes on that licence.
- **Game files.** The common view is that sharing or downloading ROMs infringes copyright, and that
  playing from a copy you made of a game you own is the defensible route. Nintendo disagrees even with
  that. Every player supplying their own file means friendslop never distributes a game, but that's
  my reading. No source says it in so many words, so a lawyer should look before this is public. The
  page would say plainly to use your own copy.

## Effort and risk

Weeks, not days. The hardest part is determinism: making sure two browsers running the same frames
always produce the same game, and catching it fast when they don't. Clock-based randomness,
leftover memory and version mismatches are the usual causes.

## Suggested first step

A spike, run locally: two browser windows playing one 2-player NES game through a local friendslop
server, in lockstep, using a GPL emulator core and a freely licensed homebrew game so no commercial
game is involved. The first thing to find out is whether a prebuilt core (EmulatorJS's or Nostalgist's
build) can be driven one frame at a time, or whether a core has to be built with Emscripten.

## Spike results (2026-10-31)

The spike is on the branch `spike/nes-lockstep` (`games/nes-lockstep/`). Its test script was kept
outside the repo.

**What it used.** jsnes 2.1.0 (Apache-2.0), an NES emulator written in plain JavaScript. It can run
exactly one frame and set each controller's buttons, so it needed no WebAssembly and no frame
changes. The game was Concentration Room v0.02a (GPL-3.0), a 2-player homebrew card game from its
author's GitHub release, kept outside the repo. The game is an ordinary friendslop link game: the
host's runner is the hub that checks fingerprints, hands out the two controllers and passes inputs
on. Input delay was 4 frames, with a memory check every 120 frames. **It needed no platform changes.**

**Results**, from a local server, so with almost no network lag:

| Browsers (host + guest) | Time | Frames | Memory checks | Drifted apart | Waits for input |
|---|---|---|---|---|---|
| Chromium + Chromium | 20 s | 1,201 | 10 | never | none |
| Chromium + Firefox | 60 s | 3,500 | 29 | never | about 400 steps on Firefox, 10 on Chromium |
| Firefox + WebKit (Safari's engine) | 60 s | 3,602 | 29 | never | 18 in all |

- **The same game stays identical across browser engines.** That was the biggest unknown, and over
  3,500 frames of random button presses no check ever differed.
- **Drift is caught.** When one browser alone saw an extra button press for a second, both browsers
  flagged "frame 1200 differed" at the next check. The first try missed, correctly: Concentration Room
  is turn-based and ignored the waiting player's pad, so nothing actually drifted.
- **Firefox paused in one run.** Between 10 and 40 seconds the Firefox player kept waiting for input,
  and in lockstep the slower browser sets the pace, so both ran at about 55 to 57 frames a second.
  Not explained yet. It may be how headless Firefox schedules timers.

**Not tested yet:**
- real network lag: it was a local server;
- a person playing: the inputs were scripted, though keyboard and gamepad are wired up;
- sound (off), a tab in the background (timers slow down there), and picking the file by hand (the
  test used a hook; the file box is there);
- WebAssembly emulators for SNES or Genesis.

**Lag, worked out.** With the host's runner as the hub, an input goes sender, server, host, server,
receiver. The input delay has to cover that whole trip, which is likely 4 to 8 frames for players in
the US talking to Render in Oregon (an estimate, not measured). Sending inputs from the server
straight to every player cuts out the host leg, likely 2 to 4 frames. That's the first platform
change worth making.

### On the live site (2026-10-31)

Next came a real-lag test. The spike branch is pushed (`spike/nes-lockstep`, which Render
doesn't deploy), and the lobby now has an input delay setting. The same script then played the game
on play.friendslop.us, both browsers on this PC, so each press went through Render and the host's
browser and back, like two laptops on one home network:

| Input delay | Frames a second after starting | Waits for input in 30 s | Drifted apart |
|---|---|---|---|
| 4 frames (67 ms) | about 50 | hundreds, all the time | never |
| 6 frames (100 ms) | 60 | 2 to 6 | never |
| 8 frames (133 ms) | 60 | none after the first seconds | never |

So with today's path (sender, server, host, server, receiver) a press needs about 6 frames to arrive
from the same network. Sending presses from the server straight to every player removes the host
leg, which should bring it near 3. The forced drift was caught on the live site too.

## Still to decide

1. How it feels to play by hand, from two laptops (not recorded yet).
2. Whether to make the server send presses straight to every player.
3. Which console to aim at after the NES.

## Sources

The two research notes behind this, with every link, were kept outside the repo.
