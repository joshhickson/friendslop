# Quiver's games on friendslop: can one host set it up for everyone?

Research, 2026-10-31. Nothing here is decided or built.

## The question

Josh, 2026-10-31: look into making friendslop work with the games Quiver Launcher installs, so that
only the host does the setup. The host serves the files, drops a link and a room code, and friends
join in their browser and play.

Quiver Launcher (`tgeorgiadis/quiver-launcher`, cloned to `D:\dev\quiver-launcher`) is a desktop app
that finds, installs and updates games people release on GitHub and GitLab: PC ports, recompilations
and fan remakes. Its catalog is public at `https://api.quiverlauncher.com/api/v1`.

## What's in the catalog

Read from the public API on 2026-10-31: 825 entries.

- **802 are ports** (plus 10 games, 7 emulators, 6 tools). 544 are tagged as recompilations: a
  console game's code translated to run natively on a PC.
- **They're desktop programs.** Windows 767, Linux 474, macOS 290, Android 145. Six descriptions
  mention playing in a browser (Chip's Challenge DX, Gran Turismo 2, ROLLER, Stunts HD, an Ultima V
  engine, a Zelda II remake), and none of those six is tagged for multiplayer.
- **150 are tagged for multiplayer.** Their READMEs mention online play in 104 and local split screen
  or shared screen in 57 (some both). The local ones are mostly party games: Mario Party, Diddy Kong
  Racing, Super Smash Bros., Perfect Dark, GoldenEye, F-Zero X, Wave Race 64, TimeSplitters, Burnout 3
  and so on.
- **Most need the original game's data.** A text search of those 150 READMEs found 120 that ask the
  player to supply their own ROM, disc or game files. It's a rough count, and several of the other 30
  need them too: engine remakes like OpenRCT2 and OpenJK run on the original game's files. Only a
  handful come with everything they need or fetch freeware data themselves, such as C-Dogs SDL, Blue
  Nebula, OpenRA and OpenTyrian.

## Why "the host serves the files" doesn't work for these

Two separate walls:

1. **The data isn't the host's to hand out.** For most of these games, the files the host has are
   extracted from a commercial game they own. Sending those to friends is distributing the game, and
   friendslop can't do that or help do it. jsDelivr's terms and Render's would both be in play, on
   top of the publishers'.
2. **They don't run in a browser.** They're native programs built for a desktop's graphics and file
   system. Turning one into a WebAssembly build is a porting project for each game, done by its
   maker, and almost none have done it.

So for these games, the browser can't run the game itself. What it can do is show the game.

## What does work: the host streams, friends play from the browser

The way Steam's Remote Play Together and Parsec do it: the game runs only on the host's computer.
friendslop sends each friend a live video of it and sends their controls back. To the game, the
friends look like extra controllers plugged into the host's PC, as if everyone were on the same couch.

**Why it fits:**
- **Only the host sets anything up.** Friends open the room link in a browser. A friend's gamepad
  works through the browser's Gamepad API, and so does the keyboard.
- **No game files leave the host's computer.** Friends get pictures and send button presses, the same
  as Remote Play Together.
- **It suits exactly the 57 local multiplayer games:** split screen and shared screen party games,
  which have no online play of their own.
- **It doesn't cost play.friendslop.us anything.** The video goes straight from the host's computer to
  each friend over WebRTC, the direct connection
  [the hosting research](2026-10-28-hosting-options.md) recommends. Our server keeps the room, the
  lobby and who has which controller slot.

**What it takes:**
- **A small friendslop program on the host's computer.** A browser tab can capture a window on its
  own (screen sharing), but it can't press buttons in another program. Something on the host's
  computer has to turn friends' input into virtual controllers. On Windows that's usually the ViGEmBus
  driver, which its author retired in 2023 and which is still widely used (to check). So the host
  installs one thing besides Quiver and the game, and friends install nothing.
- **The host's upload.** Each friend gets their own video stream. At 720p and 30 frames a second
  that's very roughly 3 to 5 Mbit/s per friend (my estimate), so three friends could need 10 to 15
  Mbit/s of upload. Many home connections can't do that. A relay that copies one stream to everyone
  (an SFU) would fix it, but Cloudflare's free one has the "video call" terms question from the
  hosting research.
- **Latency.** Fine for party, racing and co-op games. Fighting games and fast shooters will feel it.
- **Building it.** This is a Parsec-sized piece of software: capture, a video encoder, WebRTC, virtual
  controllers, and the browser side. It should build on an open-source game streaming host, such as
  Sunshine (GPL-3.0), instead of starting from nothing. Whether one of them can already stream to a
  plain browser over WebRTC needs checking.

## The other two cases

- **Games with online play (104).** Each friend needs the game and its data on their own computer, so
  the host can't do the setup for them. friendslop could still be the lobby that hands out the join
  address, but that misses the goal.
- **Freeware and open games with a web build.** These could truly run in friends' browsers, with
  files from the game's own repo, the way friendslop games load today. There are very few, and each
  would need its multiplayer adapted to friendslop's rooms. That's the
  [existing games](../../TODO.md#existing-games) work.

## Quiver itself

friendslop doesn't need Quiver's code: the streaming program can launch any game on the host's
computer. If an integration with Quiver comes up later, Quiver Launcher 4 is source-available under
the Business Source License 1.1, and each version becomes MIT licensed a year after it's published
(its LICENSE). The Quiver name and logo are covered separately (TRADEMARKS.md).

## Suggested first step

A one-evening spike, with nothing built for friendslop yet: stream one free local multiplayer game
from Josh's PC to a friend's browser and see how it feels. C-Dogs SDL is a good pick. It's free, it's
in Quiver's catalog, and it has 4-player local co-op. The spike answers three things: whether a plain
browser can join, what the host's upload has to be, and whether the lag is acceptable.

## For Josh to decide

1. Whether streaming is worth exploring, given that the host would install a small program.
2. Whether to run the spike.

## Sources

Catalog figures come from `https://api.quiverlauncher.com/api/v1/apps`, read on 2026-10-31. The
multiplayer READMEs were read from each project's GitHub repository the same day. The scripts and
their output are kept locally in `.superpowers/research/2026-10-31-quiver/` (git-ignored).
