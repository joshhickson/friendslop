# To do

What's left for friendslop (this repo, play.friendslop.us) and its website (friendslop.us). Finished
work moves to [DONE.md](DONE.md). Each item links to its details further down.

## Josh does

- [ ] [Send a test email to the contact address from another account](#contact-email)
- [ ] [Hand-check the demo: pointer lock, and the host's tab in the background](#demo-hand-checks)
- [ ] [Add the three design plugins](#website-look)
- [ ] [Decide how visitors suggest and vote on game ideas](#game-ideas)
- [ ] [Say yes or no to deleting a leftover tag and branch](#housekeeping)

## Next up

- [ ] [Study tweakyourpc/game-night for ways to stop carrying everyone's hosting ourselves](#hosting-burden)
- [ ] [Critique the website's look, then plan how text and the grid fit together](#website-look) (after the plugins)
- [ ] [Fix the games page preview text](#game-ideas) (after the decision)
- [ ] [A "Play the demo" button on play.friendslop.us](#demo-button)
- [ ] [Try packed messages in Firefox and Safari](#packed-messages-browsers)

## Later

- [ ] [Make it easier to connect games that already exist](#existing-games)
- [ ] [A list file of reviewed games, read by the games page](#reviewed-games)

## Every time

- After pushing a change to a game, [open the demo link once](#warm-jsdelivr).
- When `docs/making-a-game.md` changes, check the site's Docs page against it. The page summarizes
  the guide and links to it for details.

---

# Details

<a id="contact-email"></a>
## Contact email

contact@joshuahickson.org is the address for private messages and for privacy requests. The site's
"Talk to Josh" box, CONTRIBUTING.md and friendslop.us/privacy all give it.

- Josh, 2026-10-27: a test message didn't arrive. Josh, 2026-10-28: he thinks it works, and the test
  failed only because he sent it from the account it forwards to. Gmail hides a forwarded copy of a
  message you sent yourself, so a self-test can look like a failure when it worked.
- To prove it, send a message from a different address.
- If it still doesn't arrive, check the Cloudflare dashboard, under joshuahickson.org, Email, Email
  Routing:
  - a routing rule exists for `contact@joshuahickson.org` and is turned on;
  - its destination address is listed as **Verified** (Cloudflare sends a link that must be clicked
    first);
  - the activity log shows the test message, and whether it was delivered, dropped or rejected.
- DNS is right (checked 2026-10-27): MX points at `route1/2/3.mx.cloudflare.net` and SPF includes
  `_spf.mx.cloudflare.net`.

<a id="demo-hand-checks"></a>
## Demo hand checks

The Control Points demo plays from
`https://play.friendslop.us/?host=https://github.com/joshhickson/friendslop/tree/main/games/cp`.
Two things only a person at a keyboard can check:

- pointer lock: clicking the game grabs the mouse, and Esc opens the menu;
- the host's tab in the background mid-match: the match keeps going for everyone else.

<a id="website-look"></a>
## Website look: text over the grid

Josh, 2026-10-28: the text clashes with the grid background on friendslop.us, but the grid stays.

1. Josh adds these plugins from the Claude plugin directory (suggested 2026-10-28):
   - **audit-suite** (community): `web-design-guidelines`, `make-interfaces-feel-better`, and the
     design and accessibility audit lenses. No outside connections.
   - **Design** (Anthropic): design critique and accessibility review. Use only its skills, and leave
     its Slack connector off.
   - **Website Design** (UXKIN): page review and a written design system. Its optional UXKIN server
     isn't needed.

   They may only show up in a new session, so check what loaded before starting.
2. Run a critique of the live pages with those skills (and `frontend-design`), then show Josh the
   findings before planning any edits.
3. Ways to keep the grid and make text readable, to weigh against the critique:
   - a solid or slightly see-through panel behind blocks of text;
   - fading the grid out under reading areas;
   - a fainter grid wherever there's body text.

<a id="game-ideas"></a>
## Game ideas: a place to suggest them

The games page's preview text (its `description` and `og:description`, which Discord and other link
previews show) still says "the ones we want somebody to make". That section was removed in site
commit a9bcf76 (2026-10-27). Josh, 2026-10-28: he liked having the section, but not its examples
(hot potato grenade, lava tag and so on), and wants visitors to be able to join in, discuss and vote.

- Undecided. One option: a GitHub Discussions category for game ideas on this repo. Visitors post an
  idea, comment and upvote, and Discussions also has polls. The games page would link to it, and
  could show the top few ideas. Reading needs no account, but posting and voting need a GitHub
  account.
- Whatever is decided, fix the preview text to match the page. If the section stays out, the preview
  drops "the ones we want somebody to make".

<a id="housekeeping"></a>
## Housekeeping

Ask Josh before each delete.

- The local tag `backup/pre-strip-2026-10-27` in this repo, kept in case the history rewrite of
  2026-10-27 went wrong. The pushed history has looked right since.
- The site repo's merged local branch `instant-game-links`.

<a id="hosting-burden"></a>
## Hosting: who carries it

Josh, 2026-10-28: friendslop tells makers that hosting is easy, but so far that's only true because
play.friendslop.us carries every room itself, on a free Render plan with 150 MB of traffic a day.
To make the site show what the platform can do, we took the hosting setup and its limits on
ourselves. Find a way for hosting to really be easy for the people who use friendslop.

First lead: clone https://github.com/tweakyourpc/game-night.git and read it.

- What it is (from its README, 2026-10-28): a kit of six turn-based board and word games that
  someone installs into their own Google Sheet and its Apps Script project. Google runs the web app
  for free, the Sheet stores the game state, and the operator's Google Drive keeps replays and
  files. Each group runs its own copy on its own Google account, so nobody central pays for
  hosting. MIT licence, v0.1.0, its README says it is not production-ready.
- The idea worth taking: the people who play bring the hosting, from a free account they already
  have, instead of one shared server carrying everyone.
- Not checked yet: Apps Script answers requests one at a time and can't hold a WebSocket open, so
  it suits turn-based games. Real-time games like Control Points would need a different free host
  or a different way to connect players. Look at what game-night does for live updates, and what
  that would cost a real-time game.

<a id="demo-button"></a>
## A demo button on play.friendslop.us

A visitor who goes to play.friendslop.us directly only sees the name field and the link box. Add a
"Play the demo" button to its home screen (`client/js/screens/home.js`, wording in `shared/copy.js`)
that fills in the Control Points link.

<a id="packed-messages-browsers"></a>
## Packed messages in Firefox and Safari

Packed messages (`/ws?z=1`, see [DONE.md](DONE.md)) were checked live in Chrome only. Firefox 113
and Safari 16.4 and later support the browser's built-in decompression they need; older browsers get
plain text. Play a match in each and check Render's log says `packed messages: yes`.

<a id="existing-games"></a>
## Connecting games that already exist

Josh, 2026-10-27: find a way to connect existing games to friendslop more easily.

Today a game has to be a folder in `games/` of a fork of this repo, written around the hooks in
`server.js` and `client/index.js`. It reaches the kit by relative path (`../../server/kit/index.js`),
so it only works inside a repo shaped like this one. A game somebody already built elsewhere has to
move into a fork and be rewritten around those hooks.

Ideas to look into, none decided:
- Serve the kit from play.friendslop.us so a game imports it from there and can live in any public
  repo, with no fork.
- An adapter for games already built on a networking library (Socket.io, Colyseus, PeerJS and the
  like) that maps the game's own messages onto the room, so its code mostly stays as it is.
- An embed mode: the existing game runs in the frame and talks to the room through a small message
  API (who's here, send, receive, score, end), with friendslop's lobby around it.
- The written protocol spec, so games from other languages and engines (a Godot or Unity web build,
  say) can join rooms directly.
- First step: try to connect one or two real open-source browser multiplayer games and write down
  what got in the way. That shows which of the ideas above matters most.

<a id="reviewed-games"></a>
## A list of reviewed games

Josh, 2026-10-28: games made by other people get listed in one small file in this repo, with each
game's repo, folder and pinned commit, and the games page on friendslop.us reads from it. It keeps
every game in its maker's own repo, so authorship stays plain to see.

- Updating a listed game means changing its commit in the list, which shows up as one readable line
  in the diff for review.
- Git submodules were considered and set aside (2026-10-28):
  - a submodule update shows only a new commit hash, which is easy to approve unread;
  - play.friendslop.us loads linked games through jsDelivr, which probably doesn't follow
    submodules (not tested);
  - a plain clone leaves a submodule folder empty, which would confuse new makers.
- This is the roadmap's "Games made by other people on the games page".

<a id="warm-jsdelivr"></a>
## After every push: warm jsDelivr

The first visit to a newly pushed commit makes jsDelivr fetch the game's files for the first time.
On 2026-10-28 that took long enough that the host form gave up. The form now says "Still loading the
game..." after 15 s and waits up to 45 s, but open the demo link once yourself after pushing a game
change, so visitors get the cached copy.

## Known, not blocking

- The first load of a game at a new commit takes about 10 seconds while jsDelivr fetches it. Later
  loads come from its cache.
- Render's free service sleeps after 15 minutes without traffic, so the first visitor after a quiet
  spell waits for it to wake.
- A game's `announce` lines look like friendslop's own system chat (Josh's call).
- `/api/health` counts virtual bots as players.
- The match clock can read more than the time limit: a capture in the enemy's half adds a minute
  (`CAPTURE.bonusSeconds`), and the HUD flashes "+1:00" under the timer when it happens.

---

# Working notes

For whoever picks the work up next.

- **Live:**
  - **friendslop.us** is the site repo `joshhickson/friendslop.us` on GitHub Pages. It goes live on
    push. Local copy: `D:\dev\friendslop-site`.
  - **play.friendslop.us** is this repo on Render's free plan. The Render service is `friendslop`
    (`friendslop-2c4h.onrender.com`). It redeploys `main` on every push, in about a minute, and its
    GitHub app can see this repo only. DNS: a GoDaddy CNAME from `play` to
    `friendslop-2c4h.onrender.com`. Local copy: `D:\dev\friendslop`.
- **Try it locally** (PowerShell): `cd D:\dev\friendslop`, then
  `$env:DEV_CDN = "1"; $env:GAMES_DIR = "server/no-games"; $env:PORT = "18095"; node server/start.js`,
  then open `http://127.0.0.1:18095/?host=games/cp`. That runs the game the way production does,
  from the checkout.
- **Tools kept locally** in `.superpowers/tools/` (not on GitHub):
  - `sim-cp.mjs`: bot-only Control Points matches on a virtual clock, about 20 s per 15-minute match.
    `node .superpowers/tools/sim-cp.mjs <matches> <seed> [maxMinutes] [easy|normal|hard]` prints
    captures, the end, and the longest stretch with no capture. Run several seeds in parallel to
    compare a change.
  - `probe-traffic.mjs`: joins a running room as a player and measures what it receives.
    `MODE=plain|deflate|packed node .superpowers/tools/probe-traffic.mjs <port or https origin> <roomId> <seconds>`.
    `/api/health` shows the day's total to 0.1 MB.
- **Testing in a browser:** use Playwright. The desktop app's own browser pane can't run game frames
  (the frame never starts there). Render's logs are readable in Chrome at the service's Logs page;
  read them from a screenshot, since page scripts there are blocked.
- **Local only:** `.superpowers/` in both repos is git-ignored through `.git/info/exclude`. It holds
  the push-review diffs, the tools above, and old build ledgers.
- **How Josh works:**
  - Show him the diff before every push, unless he says to push without waiting. He creates every
    account.
  - Ask in plain text, with no pre-written answer buttons (his ask, 2026-10-28).
  - Prose: hyphens only, no em or en dashes, no "this, not that" phrasing. That includes text
    players read.
  - Git on this exFAT drive needs `-c safe.directory=D:/dev/friendslop`, and
    `-c maintenance.auto=false -c gc.auto=0` avoids a repack permission error.
  - Commits are authored as Josh Hickson `<84687634+joshhickson@users.noreply.github.com>`.
