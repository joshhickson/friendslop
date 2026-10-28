# To do

Open work for friendslop and friendslop.us, newest first. Tick an item off by deleting it.

## Where things stand (handoff, 2026-10-28, after batch 3)

Read this first when picking the work up again.

- **Live:**
  - **friendslop.us** is the site repo `joshhickson/friendslop.us` on GitHub Pages; it goes live on push. Local copy:
    `D:\dev\friendslop-site`, `main` equal to GitHub. Its merged branch `instant-game-links` can be deleted.
  - **play.friendslop.us** is this repo (`joshhickson/friendslop`) on Render's free plan. The Render service is
    `friendslop`, named `friendslop-2c4h.onrender.com`. It redeploys `main` on every push (about a minute), and its
    GitHub app can see this repo only. DNS: a GoDaddy CNAME from `play` to `friendslop-2c4h.onrender.com`. Local copy:
    `D:\dev\friendslop`, `main` equal to GitHub at a023383 when this was written.
- **The session plan of 2026-10-28** (Josh agreed it; four batches, a push after each):
  1. Done: the slow first host waits up to 45 s with a "still loading" note, the capture bonus flashes on the clock,
     the starter template is in the Blockout look, and the server logs what compression it got.
  2. Done: packed messages (see below), live and measured.
  3. Done: bot matches keep moving, the bonus rule (only captures in the enemy's half add time, Josh approved), and
     Control Points' 3D world in the Blockout look.
  4. Done 2026-10-27, live: the Docs page on friendslop.us, the `/ws?z=1` line on the
     protocol page, and the site review fixes (site commit ab06d70).
  - Then housekeeping, asking Josh before each delete: the local tag `backup/pre-strip-2026-10-27`, and the site's
    merged local branch `instant-game-links`.
- **The demo:** Control Points (`games/cp` on `games/_shooter`) plays from
  `https://play.friendslop.us/?host=https://github.com/joshhickson/friendslop/tree/main/games/cp`.
- **Try it locally** (PowerShell): `cd D:\dev\friendslop`, then
  `$env:DEV_CDN = "1"; $env:GAMES_DIR = "server/no-games"; $env:PORT = "18095"; node server/start.js`, then open
  `http://127.0.0.1:18095/?host=games/cp`. That runs the game the way production does, from the checkout.
- **Tools kept locally** in `.superpowers/tools/` (not on GitHub):
  - `sim-cp.mjs`: bot-only Control Points matches on a virtual clock, about 20 s per 15-minute match.
    `node .superpowers/tools/sim-cp.mjs <matches> <seed> [maxMinutes] [easy|normal|hard]` prints captures, the end, and
    the longest stretch with no capture. Run several seeds in parallel to compare a change.
  - `probe-traffic.mjs`: joins a running room as a player and measures what it receives.
    `MODE=plain|deflate|packed node .superpowers/tools/probe-traffic.mjs <port or https origin> <roomId> <seconds>`.
    `/api/health` shows the day's total to 0.1 MB.
- **Testing in a browser:** use Playwright. The desktop app's own browser pane can't run game frames (the frame never
  starts there). Render's logs are readable in Chrome at the service's Logs page; read them from a screenshot,
  since page scripts there are blocked.
- **Local only (not on GitHub):**
  - This file's latest commit; push it with the next change.
  - The tag `backup/pre-strip-2026-10-27`.
  - `.superpowers/` (git-ignored through `.git/info/exclude`): the push-review diffs and screenshots, the tools above,
    and the instant-game-links build ledger with `wording-for-josh.md`.
  - Nothing is running: no local servers, browser tabs or background jobs were left open.
- **Waiting on Josh:**
  1. The contact email fix in Cloudflare (his account).
  2. His hand checks of the demo (see the demo section below).
- **How Josh works:**
  - Show him the diff before every push. He creates every account.
  - Ask in plain text; no pre-written answer buttons (his ask, 2026-10-28).
  - Prose: hyphens only, no em or en dashes, no "this, not that" phrasing. That includes text players read.
  - Git on this exFAT drive needs `-c safe.directory=D:/dev/friendslop`, and `-c maintenance.auto=false -c gc.auto=0`
    avoids a repack permission error.
  - Commits are authored as Josh Hickson `<84687634+joshhickson@users.noreply.github.com>`.

## To confirm: the contact email arrives

Josh, 2026-10-27: contact@joshuahickson.org was supposed to work, and a test message didn't
arrive. Josh, 2026-10-28: he thinks it does work, and the test failed only because he sent it from
the account it forwards to. Still to prove with a message from another address. The site's "Talk
to Josh" box, CONTRIBUTING.md and the privacy page (friendslop.us/privacy, for data requests) all
give this address.

- DNS is right (checked 2026-10-27): MX points at `route1/2/3.mx.cloudflare.net` and SPF includes
  `_spf.mx.cloudflare.net`, so the domain uses Cloudflare Email Routing.
- Check in the Cloudflare dashboard, under joshuahickson.org, Email, Email Routing:
  - a routing rule exists for `contact@joshuahickson.org` and is turned on;
  - its destination address is listed as **Verified** (Cloudflare sends a link that must be
    clicked first);
  - the activity log shows the test message, and whether it was delivered, dropped or rejected.
- Test from an address other than the destination. Gmail hides a forwarded copy of a message
  you sent yourself, so a self-test can look like a failure when it worked.

## Packed messages: live since 2026-10-28

Render's proxy drops the browser's offer of WebSocket compression on the way in, so the app
compresses for itself: the browser connects to `/ws?z=1` and the server sends one deflate stream
per player (`server/packer.js`, unpacked by `client/js/unpack.js`). Checked live on 2026-10-28 in a
10 v 10 Control Points match on play.friendslop.us: Render logged `packed messages: yes`, a packed
probe player received 0.217 MB a minute and a plain one 1.709 MB. At that rate the 150 MB a day
covers about 700 player-minutes instead of about 90. Not yet tried in Firefox or Safari (both
support it from Firefox 113 and Safari 16.4; older browsers get plain text).

## After every push: warm jsDelivr

The first visit to a newly pushed commit makes jsDelivr fetch the game's files for the first time, which took long
enough on 2026-10-28 that the host form gave up. Since 2026-10-28 the form says "Still loading the game..." after 15 s
and waits up to 45 s. After pushing a change to a game, still open the demo link once yourself so a visitor gets the
cached copy.

## The Control Points demo, still open

Josh, 2026-10-27: spruce it up and serve it as a working demo with bots that play. Done: it runs
from a link with virtual bots, the unreviewed banner can be closed, the UI and (since 2026-10-28)
the 3D world are in the Blockout look, and bot matches no longer stall.

The stall, found with a fast-forward simulator of bot-only matches (`.superpowers/tools/sim-cp.mjs`,
local only: the real game and bot code in the real runner on a virtual clock, 15 minutes in about
20 seconds). Before: in 8 matches the front stuck at C for 6 to 16 minutes, about 3 captures a
match, and red won all 8. Three causes, all fixed 2026-10-28:
- Bots picked their door in each wall from a seed, so the teams spread unevenly; now by team slot.
- A push waited for 60% of all living teammates at the staging spot, defenders included, so it
  never filled and always went on the timeout; now it counts attackers only.
- 4 of 10 bots sat on a point nobody threatened; now 2 do.
After those, matches swung C back and forth about 45 times and never ended, because every capture
added a minute. Now only a capture in the enemy's half adds time (Josh to confirm this rule).
After, 12 normal and 8 easy or hard matches: 17 to 31 captures, all ended between 15:00 and 17:02,
longest quiet stretch 3:37, red 11, blue 6, draws 3.

Still open: Josh's hand checks once the demo works to his liking: pointer lock (Esc opens the
menu), and the host's tab in the background mid-match.

## One look everywhere

Done on 2026-10-28: the play app (`client/css/style.css`), the shooter's HUD, the starter template's
board, and Control Points' 3D world (paper-grey blocks outlined in ink, a graph-paper floor, orange
crates) all use the website's Blockout look and its two typefaces, which this server hosts in
`client/fonts/` for the app and every game frame.

## Before showing friendslop to a real maker

- Site review, 2026-10-27: no page said the demo was live or linked to it, the Docs page said
  "Coming soon", and the games, roadmap, bots, jam and protocol pages were behind. Fixed in site
  commit ab06d70 (Play the demo button at the top of the homepage, a real Docs page, every page
  brought up to date, listing a game is an issue everywhere). Live since 2026-10-27.
- Still open: play.friendslop.us has no demo button. A visitor who goes there directly only sees
  the link box. Add a "Play the demo" button to its home screen (`client/js/screens/home.js`,
  wording in `shared/copy.js`).
- When the platform's guide changes, check the site's Docs page against it: the page summarizes
  `docs/making-a-game.md` and links there for details.

## Open question: connecting games that already exist

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
- The written protocol spec, so games from other languages and engines (a Godot or Unity web
  build, say) can join rooms directly.
- First step: try to connect one or two real open-source browser multiplayer games and write down
  what got in the way. That shows which of the ideas above matters most.

## Planned: a list of reviewed games

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

## Website look: text over the grid

Josh, 2026-10-28: the text clashes with the grid background on friendslop.us, but the grid stays.

1. Josh adds design plugins from the Claude plugin directory. All three were suggested on
   2026-10-28:
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

## Known, not blocking

- Contact is GitHub issues, plus contact@joshuahickson.org for private messages (Josh,
  2026-10-27). The site's "Talk to Josh" box and CONTRIBUTING.md both say so.
- The first load of a game at a new commit took about 10 seconds (jsDelivr fetching it for the
  first time, 2026-10-27). Later loads come from its cache.
- Render's free service sleeps after 15 minutes without traffic, so the first visitor after a
  quiet spell waits for it to wake.
- A game's `announce` lines look like friendslop's own system chat (Josh's call).
- `/api/health` counts virtual bots as players.
- Delete the local tag `backup/pre-strip-2026-10-27` once the pushed history looks right.
- The match clock can read more than the time limit: every capture adds a minute (`CAPTURE.bonusSeconds`). Since
  2026-10-28 the HUD flashes "+1:00" under the timer when it happens.
