# friendslop: portfolio analysis (2 November 2026)

An independent read of this repository, written for its owner. Each claim carries a tag:
**[Checked: source]** means I opened that file or page myself; **[Inferred]** is my judgment;
**[Unknown]** means I could not find out. Some web pages were first found by a research helper; I
re-opened the ones tagged [Checked] myself, and the rest are tagged [Inferred].

## 1. What it is

1. friendslop is a website where you press a button, get a six-letter room code, and friends who
   type that code join the same game in their own browser tab, with no download and no account.
   [Checked: README.md, live https://play.friendslop.us]
2. It is also a free starter kit for people who make small multiplayer games: the rooms, lobby,
   teams, chat, computer-controlled players ("bots") and hosting are already built, so a maker only
   writes the game's rules and drawing code. [Checked: README.md, docs/making-a-game.md]
3. The one included game, Control Points, is a 10-against-10 blocky shooter in which bots fill
   any empty seats, so one person can try it alone. [Checked: README.md, games/cp/]

## 2. What actually works today

**What I ran:**

- `npm ci` then `npm test` on a fresh clone with Node.js. **142 tests ran, 142 passed, 0 failed,
  in about 24 seconds.** The tests start real servers and drive them with scripted connections:
  rooms, passwords, lockouts, reconnects, bots, the link-sharing relay, compression and the demo
  map. [Checked: test/*.test.js, my run]
- A local server started the way the live site runs (no games installed; the demo loaded "by link"
  from the checkout). I used a headless Chromium browser to type a name and press **Play the demo**,
  accept the first-look warning, and press **Start match**. The match opened with me plus
  19 bots across Red and Blue, the 3D arena drawn behind the team picker, and the server reported
  about 2.9 MB sent in roughly 20 seconds. [Checked: my run; screenshot kept locally, not committed]
- I did **not** play the game: a headless browser can't test aiming, mouse capture or how it feels.
  The repo's own to-do list says the same two hand checks (mouse capture, a host tab in the
  background) are still open. [Checked: TODO.md "Demo hand checks"]

**The live service:**

- https://play.friendslop.us answered, and its health endpoint showed 0 rooms, 0 players and
  0.3 MB sent so far that day against a 150 MB daily budget. [Checked: play.friendslop.us/api/health,
  2 Nov 2026]
- https://friendslop.us is live with a landing page, docs, roadmap and a jam page. It shows no
  player counts and no analytics notice. [Checked: https://friendslop.us]
- The live game frame already includes the Firefox fix, and the live site already has the **Play the
  demo** button. TODO.md still says both are "not pushed". **The to-do list is out of date.**
  [Checked: live /frame/ response headers, live shared/copy.js, TODO.md]

**Size and pace:** about 10,800 lines of JavaScript outside tests and 3,000 lines of tests
[Checked: line count]. 70 commits on `main` from 25 to 31 October 2026, 45 of them on
27 October [Checked: git log]. It is one week old. [Inferred]

## 3. Prior art

| Project | How friendslop differs, or doesn't |
|---|---|
| [Playroom Kit](https://docs.joinplayroom.com/) | **The closest match.** Its docs list room codes (`getRoomCode`), a lobby, bots (`addBot`) and host controls, with no backend for you to run. It is a company's hosted SDK and its docs state no licence for the SDK; friendslop is Apache-2.0 and can be self-hosted. [Checked: docs.joinplayroom.com] |
| [Rune](https://github.com/rune/rune) | A free hosted multiplayer platform, MIT-licensed SDK. Games run inside Rune's phone app; friendslop runs in a plain browser tab. [Checked: github.com/rune/rune] |
| [Colyseus](https://github.com/colyseus/colyseus) | The same core design: a Node.js server that is "authoritative" over rooms. MIT. It is far more mature, with no built-in room-code screen, bots or load-a-game-by-link. [Checked: github.com/colyseus/colyseus] |
| [boardgame.io](https://github.com/boardgameio/boardgame.io) | MIT, turn-based only, already has a lobby and auto-generated bots. Bots in a kit are not new. [Checked: github.com/boardgameio/boardgame.io] |
| [PartyKit](https://www.partykit.io/) | URL-addressed multiplayer rooms. Its hosted platform shut down on 23 October 2026. That makes "free, self-hostable, open licence" a real selling point right now. [Checked: partykit.io] |
| [Trystero](https://github.com/dmotz/trystero) | Browser-to-browser rooms with no server of your own. A plumbing library, not a game kit. MIT. [Checked: github.com/dmotz/trystero] |
| [rumpus](https://github.com/rodwilco/rumpus) | A one-person, self-hosted Jackbox-style platform with room codes and a `games/` folder of modules, very like friendslop's layout. AGPL-3.0, local network only, tiny. [Checked: github.com/rodwilco/rumpus] |
| [Gaming Couch (Show HN)](https://news.ycombinator.com/item?id=46344573) | Party games in the host's browser, phones join with no apps or accounts. Closed source. The same "open a tab, friends join" promise. [Checked: that HN thread] |
| [AirConsole](https://developers.airconsole.com/), [Discord Activities](https://docs.discord.com/developers/activities/overview), [Nakama](https://github.com/heroiclabs/nakama), [PeerJS](https://github.com/peers/peerjs), [NetplayJS](https://github.com/rameshvarun/netplayjs), [Lance](https://github.com/lance-gg/lance) | Hosted browser/TV game platforms, a chat-app distribution channel, a full game backend, and networking libraries. Each covers part of the same ground. [Inferred: a research helper opened these; I did not re-open them] |
| [skribbl.io](https://skribbl.io) | The everyday benchmark for "private room, copy invite link, 2–20 players". [Inferred: helper-opened] |

**Plain verdict:** room codes, lobbies, teams, bots, an authoritative Node server and a free hosted
relay all exist elsewhere, several of them in better-funded or more mature form. [Inferred]

## 4. What's novel, if anything

**Possibly novel (the combination, not the parts):** paste a link to a game folder in any public
GitHub repo, and the game is fetched from a public CDN pinned to one commit, run in the *host
player's* browser inside a locked-down frame and background worker, while the central server
runs no game code and only relays and checks messages (only the host may relay, stat names and
sizes are limited, traffic counts against a daily budget). [Checked: README.md "Games shared by
link", server/frame.js, server/remote-match.js] I found no open-source, permissively licensed
project combining *untrusted games loaded by link* + *room codes and lobby* + *bots* + *a free
relay that never runs game code*. Playroom is the nearest, and it is closed. [Inferred: from the
searches above; absence of evidence is weak evidence]. Each part is known technique: host-run
rules (Playroom, Gaming Couch), sandboxed iframes, CDN-pinned code. [Inferred]

**Nicely done, not novel:**

- The security write-up is unusually candid. It says outright that a game can still reveal a
  player's IP address through WebRTC, show a fake login box, or let the host cheat, and the
  in-game banner tells players. [Checked: README.md, shared/copy.js]
- Working around a hosting proxy that strips WebSocket compression by compressing inside the app.
  The README reports 1.70 MB/min down to 0.21 MB/min per player in a 10 v 10 match. [Checked:
  README.md states it; I did not reproduce the measurement]
- Bots that join the same way a person does, plus a bot-only simulator used to tune match length.
  [Checked: server/bots/, TODO.md "Working notes"]
- 142 passing tests for a one-week project. [Checked: my run]
- A free-plan cost guard (daily traffic budget, idle-room closing). [Checked: README.md, server/traffic.js]

**Common:** room codes, passwords, teams, chat, spectating, reconnects, a three.js low-poly shooter.
[Inferred]

**The research docs** (hosting options, browser emulators, a 2-player NES game kept in lockstep on
a public spike branch) are exploratory and interesting, but they are plans and a spike, not
shipped features. [Checked: docs/research/, branch spike/nes-lockstep]

## 5. Your part vs the agents' part

**What the repo shows:**

- 66 of 70 commits on `main` carry an AI co-author trailer. The 4 without it are the first README
  and licence commits on 25 October. [Checked: git log]
- All commits use your name as author, so authorship metadata can't separate you from the agents.
  [Checked: git log]
- The framework landed as one commit of 58 files and about 6,800 added lines ("First alpha").
  [Checked: commit ef32964]
- The docs record decisions in your name with dates, for example ruling out a Google Sheets hosting
  trick for terms-of-service risk, ruling out streaming for lag, wanting one list file for reviewed
  games, and asking for a study of modding communities. [Checked: TODO.md,
  docs/research/2026-11-01-modded-games-direction.md]
- A design spec has a section where the agent lists "calls" you delegated to it and could overrule.
  [Checked: docs/superpowers/specs/2026-10-26-game-hosting-design.md]

**What can't be told from the repo:** how much prompting each feature took; which of the agent's "calls" you checked; what you tested yourself. Your brief says you
tested every stage, but the two hand checks in TODO.md are still unticked. [Unknown]

## 6. How it could be shown

**A. A case-study page on joshuahickson.org.** Your site presents you as working on AI code
provenance and agent evaluation, and doesn't mention friendslop. [Checked: https://joshuahickson.org]
Frame friendslop as "a week directing agents to ship a live multiplayer service": the decisions you
made, the tests, the live link, and what broke (the Firefox crash found in testing). *Clean first:*
everything in section 6 below, and the stale TODO. Cost: a day. [Inferred]

**B. A 60–90 second screen recording.** Open play.friendslop.us, press Play the demo, a friend joins
by code from a second machine, a few seconds of play with bots, then paste a GitHub link to host a
second game. *Clean first:* the first-look warning and "Nobody at friendslop has played this yet"
banner appear even on your own demo [Checked: client/js/screens/home.js, shared/copy.js; my run], and
the empty home screen shows maker advice to visitors [Checked: TODO.md "demo button"]. Cost: half a
day. [Inferred]

**C. A technical write-up: "Running strangers' multiplayer games for free without running their
code."** The relay, the sandbox, what it can't stop, the compression numbers. *Clean first:* re-measure
the compression claim yourself on the live site and publish the method. Cost: 1–2 days. [Inferred]

**What the public repo should tidy (paths and kinds only)** [Checked: each file named]

- `TODO.md`, "Working notes": Windows local folder paths, the hosting service's internal hostname,
  the domain registrar, git workarounds for your drive, and "How Josh works" (your review habits,
  prose rules, commit author email).
- `TODO.md`, "Contact email": your contact address and notes on debugging your own inbox and mail
  routing.
- `TODO.md` "Hosting" and "Connecting games": GitHub handles of two other developers whose repos
  were studied.
- `docs/research/2026-10-31-quiver-games-multiplayer.md`: another developer's handle and a local path.
- `docs/research/2026-11-01-modded-games-direction.md`: a personal anecdote about your phone and
  your stated preferences.
- `docs/superpowers/plans/2026-10-26-instant-game-links.md`: local paths (5 places), a git command
  with your personal email, and step-by-step agent instructions.
- `docs/superpowers/specs/...`: process notes in your name ("Josh wants…").
- `DONE.md`: one local path.
- `CONTRIBUTING.md`: your email and a social handle. That may be intended; it is your call.
- Git history: every commit's metadata carries your email address on GitHub. Changing that for
  future commits means a GitHub no-reply address; old commits can't change without rewriting history.
- Public branches `reality-check-casino`, `reality-check-demo`, `spike/nes-lockstep`: unfinished
  work visitors will see. TODO.md calls the spike branch local-only, but it is pushed.
- TODO.md: stale "not pushed" items (see section 2).

Don't just delete the process notes. Section 8 explains why.

## 7. What could make it portfolio-worthy

**First, the cold-start problem.** A 10 v 10 game needs several people online at once, and the
live service had 0 players when I checked. Bots solve "it works alone"; they don't make it social.
[Checked: /api/health; Inferred]

**Getting real people to try it:**

1. **A Show HN with a playable link.** HN's rules require something people can try, with no signup,
   built by you, and you available to discuss it. friendslop qualifies. [Checked:
   https://news.ycombinator.com/showhn.html] The comparable post (Gaming Couch, 437 points) led with
   "no apps, no accounts", and commenters raised input lag, smart-TV browsers and whether it was open
   source. [Checked: news.ycombinator.com/item?id=46344573] friendslop answers that last one.
   Post the playable link, not the repo. Risk: the free server sleeps after 15 minutes and wakes in
   about a minute, which will meet the first visitors. [Checked: README.md] Pay for an always-on
   instance for launch week. Cost: half a day plus a few dollars. [Inferred]
2. **Scheduled game nights.** Post fixed times ("Thursday 8pm UTC, room code on the page") so
   strangers arrive together. Cost: an hour a week. [Inferred]
3. **The second game matters more than the shooter.** A 2–3 minute party game that works with three
   people would fit "friendslop" better than a 15-minute 20-player shooter. The rumpus trivia adapter
   spike already points that way. [Checked: TODO.md "Connecting games"; Inferred]
4. **Run the jam the site already advertises,** with a 48-hour window and the link-hosting path as
   the only entry route. Even three entries prove that someone other than you can make a game on it.
   Cost: a weekend plus outreach. [Checked: friendslop.us nav has "Jam"; Inferred]

**Measuring honestly.** Nothing in the repo measures use today: no analytics, and the logs record
rooms and match starts. [Checked: server/rooms.js, server/room.js] TODO.md notes that the health
endpoint counts virtual bots as players, so current numbers can't separate people from bots.
[Checked: TODO.md "Known, not blocking"] A small, privacy-friendly addition (half a day of agent
time) [Inferred]:

- Daily counters with no IPs or names: rooms created, matches with **2 or more humans**, matches
  that reach their end, distinct games hosted by link.
- Exclude your own tests (a flag only you set).
- Decide a target before launch (say "10 matches with 2+ humans in 14 days") and publish the result
  even if it's zero.
- Five recorded playtests with people who haven't seen it, with what confused them.

**A sharper framing for a hiring manager.** Your site sells evaluation of AI coding agents.
[Checked: https://joshuahickson.org] friendslop's strongest evidence for *that* is the trail: dated
decisions, delegated calls, a stale to-do list that drifted from what was deployed, a bug caught in
cross-browser testing. A short audit, "how well did the agents' own notes match what shipped?", turns
this repo into a sample of the work you say you do. Cost: 1–2 days. [Inferred]

**A small addition that shows off the novel part:** a one-page "host your own game in 5 minutes"
walkthrough that a stranger completes on video, timed. [Inferred]

## 8. Meta-analysis of this brief

- **"Show it" assumes it is ready to be shown to players.** It runs and is well tested, but it has
  one game, no recorded players, and a to-do list that disagrees with production. To a peer it is a
  promising alpha; to a hiring manager, as it stands, it is a weekend-scale side project.
  [Inferred]
- **The brief asks how to tidy "notes about how I work". For your stated positioning, those notes
  may be the most valuable thing in the repo.** Move them into a curated case study rather than
  deleting them. [Inferred]
- **Prior art framed as "room-code kits" undersells the one distinctive idea:** free hosting of
  untrusted games by link, with the server never running them. A better question: "Is that idea
  safe and useful enough that strangers will host games with it?" [Inferred]
- **The brief treats players as the success measure.** For a kit, makers matter more: one outside
  person shipping a game on it is stronger evidence than 100 people trying the demo. [Inferred]
- What I would have asked: "Which single piece of evidence would make this project credible to the
  reader I want, and what is the cheapest way to produce it before 4 November?" [Inferred]
- Two days remain before 4 November. The cleanup plus option A fits; a launch and honest measurement
  don't. Showing the measurement plan with "results pending" is more honest than rushing a
  launch. [Inferred]

## 9. Questions only you can answer

1. Who is the portfolio for: AI-evaluation employers, game studios, or open-source peers? The answer
   changes which option in section 6 fits. [Unknown]
2. Which of the agent's delegated "calls" did you review, and did you change any? [Unknown]
3. What did "tested every stage" involve: playing it yourself, with friends, in which browsers? Have
   you done the two open hand checks? [Unknown]
4. Has anyone other than you played on the live site, and has anyone outside made a game on it?
   [Unknown]
5. Do you want your email, social handle and working style public on GitHub at all? [Unknown]
6. Are the `reality-check-*` branches meant to be public? [Unknown]
7. Will you keep paying for and maintaining the live service after 4 November? A portfolio link that
   sleeps or dies hurts more than no link. [Unknown]
