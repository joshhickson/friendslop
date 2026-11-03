# To do

What's left for friendslop (this repo, play.friendslop.us) and its website (friendslop.us). Finished
work moves to [DONE.md](DONE.md). Each item links to its details further down. Last brought up to
date 2026-11-02.

## Josh does

- [ ] [Confirm which demo is signed off, and say yes to the banner change going live](#signed-off-demo)
- [ ] [Settle what the Nov 7 friends test is](#nov-7) (blocks any build work for it)
- [ ] [Play the demo with friends, and write down what happened](#usage) (nobody outside has played yet)
- [ ] [Hand-check the demo: pointer lock, and the host's tab in the background](#demo-hand-checks)
- [ ] [Decide the three hosting questions](#hosting-burden)
- [ ] [Decide what happens to the public side branches](#side-branches) (decide later; save them first)
- [ ] [Send a test email to the contact address from another account](#contact-email)
- [ ] [Add the three design plugins](#website-look)
- [ ] [Decide how visitors suggest and vote on game ideas](#game-ideas)
- [ ] [Say yes or no to deleting a leftover local tag and branch](#housekeeping)

## Next up

- [ ] [The Nov 7 friends test](#nov-7) (after Josh settles what it is)
- [ ] [Count real use: rooms, matches with 2 or more people, matches that finish](#usage)
- [ ] [Reword the empty "Create room" tab](#empty-create-tab) (it gives visitors maker advice)
- [ ] [Critique the website's look, then plan how text and the grid fit together](#website-look) (first pass done, the plugins' audits next)
- [ ] [Fix the games page preview text](#game-ideas) (after the decision)

## Later

- [ ] [Make it easier to connect games that already exist](#existing-games)
- [ ] [A list file of reviewed games, read by the games page](#reviewed-games) (a first step is in `shared/signed-off.js`)
- [ ] [Retro games in the browser, each player with their own copy](#browser-emulators) (spike works over the live site)

## Every time

- After pushing a change to a game, [open the demo link once](#warm-jsdelivr).
- When `docs/making-a-game.md` changes, check the site's Docs page against it. The page summarizes
  the guide and links to it for details.
- A push to `main` redeploys play.friendslop.us, so nothing goes to `main` without Josh's yes.

---

# Details

<a id="signed-off-demo"></a>
## The signed-off demo and its banner

Every game hosted from GitHub shows a banner: "Nobody at friendslop has played this yet...". That was
also true of friendslop's own Control Points demo. Decision, Nov 2: remove the banner from demos Josh
has signed off on, of which there is one so far.

- On branch `portfolio/nov4` (not live): `shared/signed-off.js` lists the signed-off games, and the
  match screen skips the banner for them. It lists one game, the Control Points demo
  (`joshhickson/friendslop`, `games/cp`), at any commit. Other repos, forks and folders still get the
  banner. Tested in `test/signed-off.test.js`, and checked in a browser on a local server.
- To confirm: that Control Points is the signed-off demo. It's the only game this repo calls "the
  demo", but Josh hasn't said so in words.
- Still shown for it: the one-time first-look warning ("Heads up: nobody has checked this game. Like
  any website, it can see your IP address..."). Its first half is no longer true for the demo; its
  second half is a real privacy notice. Josh decides whether it changes.
- Going live means merging to `main`, which needs Josh's yes on the final wording.

<a id="nov-7"></a>
## The Nov 7 friends test

Decision, Nov 2: the first target after Nov 4 is a friends test on Saturday 2026-11-07 with a 3D
build of a game similar to Halo Wars 2's Terminus Firefight (co-op base defence against waves).

- Halo Wars 2 itself can't run in friendslop: Microsoft owns its code and art, there's no source, and
  rebuilding it would be a copy of a specific game. It already has online co-op on Xbox and Windows,
  so a night of the real game needs no friendslop at all
  ([the modded games note](docs/research/2026-11-01-modded-games-direction.md)).
- An original game in that genre, with its own name, units and art, can be built on friendslop. The
  kit has 3D (three.js), rooms, teams, bots and a navigation grid. Nothing like it exists yet:
  Control Points is a first-person shooter, not a strategy game.
- What's open: which of those two Josh means, how many players, and how much can fairly be built in
  the days left after Nov 4.

<a id="usage"></a>
## Real use, and counting it

Nobody outside has played friendslop yet, as far as anyone knows, and Josh hasn't yet played the demo
with friends. Nothing in the code keeps a count over time: `/api/health` is a live snapshot held in
memory, and it counts bots as players. On 2026-11-03 at about 07:50 UTC it read 0 rooms, 0 players.

- A counter with no IP addresses and no names: rooms made, matches with 2 or more people, matches that
  finish, and how long they ran. Kept somewhere that survives a restart.
- A target set before looking, and a few recorded playtests.
- Until then, say it plainly: built and tested, not yet used.

<a id="demo-hand-checks"></a>
## Demo hand checks

The Control Points demo plays from
`https://play.friendslop.us/?host=https://github.com/joshhickson/friendslop/tree/main/games/cp`.
Two things only a person at a keyboard can check:

- pointer lock: clicking the game grabs the mouse, and Esc opens the menu;
- the host's tab in the background mid-match: the match keeps going for everyone else.

<a id="side-branches"></a>
## Public side branches

`reality-check-demo`, `reality-check-casino`, `spike/nes-lockstep`, `analysis/portfolio-2026-11`,
`audit/2026-11` and `portfolio/nov4` are all public and unmerged. Decision on the two
`reality-check-*` branches, Nov 2: decide later, and save them somewhere safe before any delete.
Nothing to do now. Their older copies of this file still have the working notes this version
removed.

<a id="contact-email"></a>
## Contact email

contact@joshuahickson.org is the public address for private messages and privacy requests (Josh's
call, Nov 2). The site, CONTRIBUTING.md and friendslop.us/privacy give it. A test
from a different account would prove it delivers.

<a id="website-look"></a>
## Website look: text over the grid

Decided 2026-10-28: the text clashes with the grid background on friendslop.us, but the grid stays.

1. Add these plugins from the Claude plugin directory (suggested 2026-10-28):
   - **audit-suite** (community): `web-design-guidelines`, `make-interfaces-feel-better`, and the
     design and accessibility audit lenses. No outside connections.
   - **Design** (Anthropic): design critique and accessibility review. Use only its skills, and leave
     its Slack connector off.
   - **Website Design** (UXKIN): page review and a written design system. Its optional UXKIN server
     isn't needed.
2. Run a critique of the live pages with those skills, then show the findings before planning any
   edits. A first pass is in
   [docs/research/2026-10-28-site-look-critique.md](docs/research/2026-10-28-site-look-critique.md).
3. Ways to keep the grid and make text readable: a panel behind blocks of text, fading the grid under
   reading areas, or a fainter grid wherever there's body text.

<a id="game-ideas"></a>
## Game ideas: a place to suggest them

The games page's preview text (its `description` and `og:description`) still says "the ones we want
somebody to make", though that section was removed in site commit a9bcf76 (2026-10-27). The section
is wanted back without its old examples, with a way for visitors to join in, discuss and vote.

- Undecided. One option: a GitHub Discussions category for game ideas on this repo, linked from the
  games page. Reading needs no account; posting and voting need a GitHub account.
- Whatever is decided, fix the preview text to match the page.

<a id="housekeeping"></a>
## Housekeeping

Ask before each delete.

- A local backup tag from the history rewrite of 2026-10-27. The pushed history has looked right
  since.
- The site repo's merged local branch `instant-game-links`.

<a id="empty-create-tab"></a>
## The empty "Create room" tab

play.friendslop.us has no games installed of its own (the demo loads by link), so its "Create room"
tab says "No games are installed on this server yet... make one with npm run new-game", which is
maker advice on a page visitors see. Reword it, or point it at "Play the demo". The text is
`noGamesYet` in `shared/copy.js`.

<a id="hosting-burden"></a>
## Hosting: who carries it

friendslop tells makers that hosting is easy, but so far that's only true because play.friendslop.us
carries every room itself, on a free plan with 150 MB of traffic a day. The aim is for hosting to be
really easy for the people who use friendslop.

The research is done: [docs/research/2026-10-28-hosting-options.md](docs/research/2026-10-28-hosting-options.md).
It recommends letting the host's browser send its room's game messages straight to each player, with
our server as the fallback, and lists three decisions, still open.

It started from game-night, an MIT-licensed kit of turn-based games that each group runs from its own
Google Sheet and Apps Script. Decided 2026-10-28: don't copy that mechanic, since it risks breaking
Google's terms. The idea worth taking: the people who play bring the hosting.

<a id="existing-games"></a>
## Connecting games that already exist

Today a game has to be a folder in `games/` of a fork of this repo, written around the hooks in
`server.js` and `client/index.js`. Ideas, none decided:

- Serve the kit from play.friendslop.us so a game can live in any public repo, with no fork.
- An adapter for games already built on a networking library (Socket.io, Colyseus, PeerJS).
- An embed mode: the game runs in the frame and talks to the room through a small message API.
- The written protocol spec, so games from other languages and engines can join rooms directly.

**First try, 2026-11-01:** Trivia Blast from the open-source Rumpus project (AGPL-3.0) ran through a
120-line adapter, on a branch that isn't on GitHub. What got in the way: its files were written for
Node so they had to become ES modules, its timers use the host's clock, and friendslop players load
into a match one by one. The adapter idea held up. Its AGPL licence matters if it ever ships in this
Apache-2.0 repo. More in [the modded games note](docs/research/2026-11-01-modded-games-direction.md).

<a id="reviewed-games"></a>
## A list of reviewed games

Games made by other people get listed in one small file in this repo, with each game's repo, folder
and pinned commit, and the games page on friendslop.us reads from it. Every game stays in its maker's
own repo, so authorship stays plain to see. Updating a listed game means changing its commit in the
list, one readable line in the diff. Git submodules were considered and set aside (2026-10-28).
`shared/signed-off.js` (branch `portfolio/nov4`) is a first, smaller version of this list.

<a id="browser-emulators"></a>
## Retro games in the browser

Every player's browser runs the same open-source emulator, each player picks their own copy of the
game file, and only controller input travels
([research](docs/research/2026-10-31-browser-emulators.md)). Streaming from the host was ruled out
for lag ([the Quiver note](docs/research/2026-10-31-quiver-games-multiplayer.md)).

Spike, 2026-10-31, on branch `spike/nes-lockstep` (pushed): a 2-player homebrew NES game ran in
lockstep with no platform changes. Over the live site it needed 6 frames of input delay. Not yet
recorded: how it feels to play by hand. Next: sending inputs from the server straight to every player.

<a id="warm-jsdelivr"></a>
## After every push: warm jsDelivr

The first visit to a newly pushed commit makes jsDelivr fetch the game's files for the first time,
which can take long enough that the host form waits (it says "Still loading the game..." after 15 s
and waits up to 45 s). Open the demo link once after pushing a game change, so visitors get the
cached copy.

## Known, not blocking

- Render's free service sleeps after 15 minutes without traffic, so the first visitor after a quiet
  spell waits for it to wake.
- A game's `announce` lines look like friendslop's own system chat (a deliberate call).
- `/api/health` counts virtual bots as players.
- The match clock can read more than the time limit: a capture in the enemy's half adds a minute
  (`CAPTURE.bonusSeconds`), and the HUD flashes "+1:00" under the timer when it happens.

---

# Working notes

- **Live:** friendslop.us is the site repo `joshhickson/friendslop.us` on GitHub Pages, live on push.
  play.friendslop.us is this repo on Render's free plan; it redeploys `main` on every push, in about a
  minute.
- **Try it locally:** set `DEV_CDN=1`, `GAMES_DIR=server/no-games` and `PORT=18095`, run
  `node server/start.js`, then open `http://127.0.0.1:18095/?host=games/cp`. That runs the game the
  way production does, from the checkout.
- **Testing in a browser:** use Playwright.
