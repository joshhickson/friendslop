# To do

Open work for friendslop and friendslop.us, newest first. Tick an item off by deleting it.

## Where things stand (handoff, 2026-10-28)

Read this first when picking the work up again.

- **Live:**
  - **friendslop.us** is the site repo `joshhickson/friendslop.us` on GitHub Pages; it goes live on push. Local copy:
    `D:\dev\friendslop-site`, `main` equal to GitHub. Its merged branch `instant-game-links` can be deleted.
  - **play.friendslop.us** is this repo (`joshhickson/friendslop`) on Render's free plan. The Render service is
    `friendslop`, named `friendslop-2c4h.onrender.com`. It redeploys `main` on every push, and its GitHub app can see this
    repo only. DNS: a GoDaddy CNAME from `play` to `friendslop-2c4h.onrender.com`. Local copy: `D:\dev\friendslop`, `main`
    equal to GitHub at 9cc77ae when this was written.
- **The demo:** Control Points (`games/cp` on `games/_shooter`) plays from
  `https://play.friendslop.us/?host=https://github.com/joshhickson/friendslop/tree/main/games/cp`.
  A full 10 v 10 match with 19 bots ran there on 2026-10-28.
- **Try it locally** (PowerShell): `cd D:\dev\friendslop`, then
  `$env:DEV_CDN = "1"; $env:GAMES_DIR = "server/no-games"; $env:PORT = "18095"; node server/start.js`, then open
  `http://127.0.0.1:18095/?host=games/cp`. That runs the game the way production does, from the checkout.
- **Measuring traffic:** join a room from Node with `ws` as a player, send `match:ready`, and compare the text received
  with `ws._socket.bytesRead` (the bytes on the wire). `/api/health` shows the day's total to 0.1 MB.
- **Local only (not on GitHub):**
  - This file's latest commits; push them with the next change.
  - The tag `backup/pre-strip-2026-10-27`.
  - `.superpowers/` (git-ignored through `.git/info/exclude`): the push-review diffs, and the instant-game-links
    build ledger with `wording-for-josh.md`.
  - Nothing is running: no local servers, browser tabs or background jobs were left open.
- **Waiting on Josh:**
  1. The contact email fix in Cloudflare (his account).
- **How Josh works:**
  - Show him the diff before every push. He creates every account.
  - Ask in plain text; no pre-written answer buttons (his ask, 2026-10-28).
  - Prose: hyphens only, no em or en dashes, no "this, not that" phrasing.
  - Git on this exFAT drive needs `-c safe.directory=D:/dev/friendslop`.
  - Commits are authored as Josh Hickson `<84687634+joshhickson@users.noreply.github.com>`.

## Required fix: the contact email doesn't arrive

Josh, 2026-10-27: contact@joshuahickson.org was supposed to work, and a test message didn't
arrive. The site's "Talk to Josh" box and CONTRIBUTING.md both give this address, so mail sent
there is lost until it's fixed.

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

Josh, 2026-10-27: spruce it up and serve it as a working demo with bots that play. Done so far: it runs from a link with
virtual bots, the unreviewed banner can be closed, the UI is in the Blockout look. Still open:
- **Stalemates:** in long bot matches the front line tends to stick at point C (from the alpha's own runs).
- Josh's hand checks, once the demo works to his liking: pointer lock (Esc opens the menu), and the host's tab in
  the background mid-match.

## One look everywhere

Done on 2026-10-28 for the play app (`client/css/style.css`) and the shooter's in-game HUD; both use the website's
Blockout look and its two typefaces, which this server now hosts in `client/fonts/` for the app and every game frame.
The starter template's board followed on 2026-10-28. Left: the 3D worlds themselves (grey boxes on a flat green
floor).

## Before showing friendslop to a real maker

- The Docs page on friendslop.us still says "Coming soon". The homepage's "Make your first game"
  section has the agent prompt and the steps meanwhile.

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
