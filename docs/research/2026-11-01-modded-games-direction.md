# Modded games, and where friendslop fits

Notes to sit on, 2026-11-01. Nothing here is decided or to be built yet.

## Why this note

Josh, 2026-11-01, after talking with his friends:

- They suggested a light Jackbox-style game next week. Trivia Blast from Rumpus
  (branch `spike/rumpus-trivia`) will probably be the demo.
- **Their real interest is modded games.** Two examples came up: Halo Wars 2's Terminus Firefight,
  which "would go hard in online multiplayer", and the custom Zombies maps for Call of Duty: Black
  Ops III, whose makers are respected for maps that look and play like the official ones.
- **The main goal is getting 2D and 3D games to work reliably.**
- Josh asked to revisit the earlier notes on where the game industry, modding, ROMs and AI reverse
  engineering are heading, and his view that multiplayer and access are the next bottleneck.

## What the earlier notes said

The two reports Josh gave on 2026-10-25 were discussed in chat but never saved in this repo. Copies
of both, and an excerpt of that chat with the GitHub checks, are now kept locally in
`.superpowers/research/2026-10-25-reports/` (git-ignored). In short:

- **"Cutting-Edge Game Rewrites"** (a Gemini report, no sources) described three movements:
  1. AI-assisted rewrites from scratch in Rust/WebAssembly or three.js, playable instantly in a
     browser, including on phones. Josh saw one, a Minecraft-like game on his iPhone, and said he wants
     to explore Rust and modern game rewrites later (session notes, 2026-10-25).
  2. AI-assisted decompilation and recompilation of old games to WebAssembly: Quake and Doom ports,
     OpenRA, the Mario 64 decompilation. The report also claimed Halo and Wind Waker work, which I
     marked as doubtful.
  3. Neural "world model" games (Oasis, GameNGen), where a model draws every frame. Research-grade.

  Its point on multiplayer was that a shared link is now the easy way in: WebRTC between browsers,
  WebTransport for speed, and cloud servers that run game code.
- **"Open-Source AI NPC Frameworks"** mostly covered Unity and Unreal plugins. What fitted was the
  pattern friendslop already has: bots join as ordinary players, so an outside program (an AI agent,
  say) can play.
- **The GitHub check** found several wrong licences. Suroi (GPL-3.0) is the closest open example of
  instant browser multiplayer with phone controls. Chronodivide, the browser Red Alert 2, is closed
  source.
- **What came out of it:** friendslop's licence became Apache-2.0, and the README says the
  network protocol is the lasting part, so other languages (a Rust/WebAssembly client, say) can join
  the same rooms later.

Since then:

- [Quiver's games](2026-10-31-quiver-games-multiplayer.md): of 825 recompiled and ported PC games,
  150 have multiplayer, and most need the original game's files. They're desktop programs.
- [Retro games in the browser](2026-10-31-browser-emulators.md): every player runs the same emulator
  with their own copy of the game, and only button presses travel. The NES spike works, with 6 frames
  of input delay over the live site today.
- Trivia Blast: a game made for another platform ran on friendslop through a 120-line adapter.

## The two new examples

**Terminus Firefight** is a co-op mode for 1 to 3 players in Halo Wars 2, from its Awakening the
Nightmare expansion: build a base and hold off endless waves of UNSC, Banished and Flood forces
([Halopedia](https://www.halopedia.org/Terminus_Firefight)).

- It's a real-time strategy mode, and **it already has online co-op**, with Xbox and Windows PC
  crossplay since a November 2017 patch ([TweakTown](https://www.tweaktown.com/news/59749/halo-wars-2-now-xbox-one-pc-cross-play-enabled/index.html),
  [Microsoft Store](https://apps.microsoft.com/detail/9plsbtjb87q7)). Whether crossplay still
  works today, I haven't checked.
- So the hard part for Josh's friends is probably getting set up: everyone needs Halo Wars 2 on a
  Windows PC or an Xbox, with the expansion, signed in to Xbox.
- **The Halo Wars first-person mod:** two searches found none, only overhaul mods, a Battlefront II
  conversion with Halo Wars units, and third-person mods for Halo 1 and 2. Worth asking the friends
  for a link.

**Black Ops III custom Zombies:**

- **Treyarch gave players its own tools,** free on Steam: the Radiant level editor, the asset
  editor, and optional packs of building pieces from the official maps
  ([Prima Games](https://primagames.com/?p=311951)). The beta came with a full official Zombies map,
  The Giant, to learn from.
- **Players need only the base game.** Steam Workshop installs a map in one click, and the creators'
  tools stay with the creators.
- **Creators add scripts and animations, and port pieces from other games**
  ([Zombies Plus wiki](https://zombiesplusworkshop.fandom.com/wiki/Custom_Zombies)). Porting from
  other games is a legal grey area.
- **The best maps follow Treyarch's design rules** and add their own story on top. Leviathan and
  Halle Der Toten are the names that keep coming up. These come from fan lists, so they're opinion.

My read of why the maps look official: the makers have the developer's own editor, the developer's
own art, and the developer's maps to copy from, and one click gets their map to players. The skill
and the effort are theirs, and the platform removed everything else in the way. That's a guess from
the sources above. Asking the friends what makes a map great to them would test it.

## Josh's thesis, laid out

Making games is getting cheaper fast: AI writes code, decompilations turn old games into source,
and the browser runs 3D well. What stays hard is **getting a group of friends into the same game at
the same time**: everyone owning and installing the same thing, the same version, a host, a working
connection. That's the bottleneck Josh named, and it's friendslop's whole pitch: send a link, play.

The examples sort into three groups by how hard that is.

| Group | Examples | Can friends join from a browser? |
|---|---|---|
| Games made for friendslop | Control Points, Trivia Blast | Yes, today. The work is making 2D and 3D reliable |
| Old games, each player with their own copy | NES (working), Game Boy, SNES, Genesis | Yes, with emulators in lockstep. Consoles after the NES aren't tried |
| Big native games and their mods | Halo Wars 2, Black Ops III Zombies | No. They need the PC game installed, and some need a console account |

For the third group, friendslop could at best be the place friends gather: who's playing, which mod
and version, how to join. [The Quiver note](2026-10-31-quiver-games-multiplayer.md) found that this
misses the goal, because each friend still installs everything. Streaming from the host was ruled
out for lag, and browser ports of decompiled 3D games are legally risky and mostly don't exist.

## What Black Ops III's modders suggest for friendslop

The part that transfers is the setup, which friendslop can copy for its own games:

1. **Creators get the same tools as the official games.** friendslop already does this: Control
   Points is built on the same kit any game gets. The missing pieces are a map or level editor, and
   shared art packs, so a creator's 3D map can look like the official ones.
2. **One click to play a creator's work.** The GitHub link and the
   [list of reviewed games](../../TODO.md#reviewed-games) are friendslop's Workshop. The player
   installs nothing, which beats Steam.
3. **Official example maps to learn from.** A creator's first step is opening a complete, polished
   map. friendslop's own games are that, so they need to be good.
4. **Mods on top of games, as well as new games.** Zombies maps are mods of one game. A friendslop
   game could take maps, rules or skins from other people's repos.

## Limits to keep in mind for "3D, reliably"

- **File size.** Games load through jsDelivr: 20 MB a file and 150 MB a commit. A 3D game with
  official-looking art will press on that.
- **Lag.** Inputs go through Render and the host's browser, and the NES needed 6 frames of delay. A
  shooter will feel that. Sending inputs straight from the server to every player, then WebRTC, are
  the known fixes ([hosting research](2026-10-28-hosting-options.md)).
- **Phones.** First-person games need touch controls, which nobody has built for friendslop yet.
- **Hosting.** The free Render plan allows 150 MB a day, and a 3D action game moves far more data
  than trivia.

## Questions to sit on

1. Do the friends want to play Halo Wars 2 and Black Ops III themselves, or would they be as happy
   with friendslop games that have that quality and a mod scene of their own? The answer decides
   whether group three matters.
2. Is a level editor (the Radiant idea) the next big piece for 3D, ahead of more games?
3. Which matters more for next week's friends test: the trivia demo going smoothly, or showing them
   one 3D game?
4. Where does the Rust/WebAssembly interest go: a faster 3D client later, or a way to run old engines
   in the browser?

## Josh's answers, 2026-11-01

1. The friends want Halo Wars 2, or a first-person Halo, with friends. Josh expects both would need
   custom modding for multiplayer.
2. No decision on a level editor. He wants a **study of the modding community**: why mods appeal, and
   large mod sites such as Nexus Mods.
3. **For the friends test: one 3D game with working multiplayer, ideally Halo Wars 2 or Halo Wars 1,
   by Saturday 2026-11-07.**
4. He raised Rust because people are rewriting games in it, and guesses it makes faster clients.

What I found after his answers (fan and store sources, not checked by playing):

- **Halo Wars 2 still has online play in 2026,** with quick matchmaking and a small share of
  Terminus Firefight matches, on Xbox and on Windows through the Microsoft Store, Xbox app and Game
  Pass ([Team Respawn](https://www.teamrespawn.net/blog/posts/how-many-people-still-play-halo-wars-2-2026/),
  [Xbox store](https://www.xbox.com/en-US/games/store/halo-wars-2/9nblggh5wmkm)). No mod is needed
  for online co-op. I didn't find it on Steam.
- **Halo Wars: Definitive Edition is on Steam,** and its mods can work online when every player has
  the same mod at the same version ([Nexus](https://www.nexusmods.com/halowarsdefinitiveedition/mods/46),
  [ModDB](https://www.moddb.com/games/halo-wars-definitive-edition/mods)). Mod managers exist
  (Firebase, Haruspis).
- **Halo Wars can't run in friendslop.** Microsoft owns its code and art, there's no source, and
  rebuilding it would be a copy of a specific game. A Halo Wars night would run in the games
  themselves. Keeping everyone on the same mod version is the friction there, which ties into the
  community study.
