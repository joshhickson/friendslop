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
    equal to GitHub at 79853e3 when this was written.
- **The demo:** Control Points (`games/cp` on `games/_shooter`) plays from
  `https://play.friendslop.us/?host=https://github.com/joshhickson/friendslop/tree/main/games/cp`.
  A full 10 v 10 match with 19 bots ran there on 2026-10-28.
- **Try it locally** (PowerShell): `cd D:\dev\friendslop`, then
  `$env:DEV_CDN = "1"; $env:GAMES_DIR = "server/no-games"; $env:PORT = "18095"; node server/start.js`, then open
  `http://127.0.0.1:18095/?host=games/cp`. That runs the game the way production does, from the checkout.
- **Measuring traffic:** join a room from Node with `ws` as a player, send `match:ready`, and compare the text received
  with `ws._socket.bytesRead` (the bytes on the wire). `/api/health` shows the day's total to 0.1 MB.
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

## Next: compression doesn't survive Render's proxy

Josh chose "compress with memory of recent messages" (2026-10-28). The server does it (commit 2e79679): locally a
10 v 10 Control Points match cost one player 0.21 MB a minute instead of 1.67 MB. **On play.friendslop.us it doesn't
happen.** Render puts Cloudflare in front of every service, and the handshake reply that comes back through it has no
`Sec-WebSocket-Extensions` line, though the same server answers with one when reached directly. So a live player still
receives about 1.67 MB a minute, and the 150 MB a day covers about 90 player-minutes. The meter is right either way:
it counts the bytes the server writes.

Options, for Josh to pick:
- **Compress in the app** (closest to his choice): the server sends binary frames from one zlib stream per connection,
  flushed per message, and the browser inflates them with `DecompressionStream('deflate-raw')`, which keeps the same
  memory across messages. It needs a protocol version bump and a fallback for clients without `DecompressionStream`.
- **A compact snapshot format** in `games/_shooter` (measured: about a third of today's size), and/or **fewer
  snapshots** (15 a second down to 10).
- First, find out whether Cloudflare drops the offer on the way in or the answer on the way out: log once per run
  whether the upgrade request carried `sec-websocket-extensions`, as the server already does for proxy headers.

## Next: the first host after a push times out

The first "Host this game" for a newly pushed commit failed on 2026-10-28 with "GitHub took so long to answer...".
GitHub answered at once; the game's files were slow because jsDelivr was fetching that commit for the first time. The
second try worked. Every push to the demo will do this to its first visitor. Ideas: a longer wait for the hidden check
with a "still loading the game" line, and/or fetching the demo's files once right after each push to warm jsDelivr.

## The Control Points demo, still open

Josh, 2026-10-27: spruce it up and serve it as a working demo with bots that play. Done so far: it runs from a link with
virtual bots, the unreviewed banner can be closed, the UI is in the Blockout look. Still open:
- **Stalemates:** in long bot matches the front line tends to stick at point C (from the alpha's own runs).
- **The match clock read 15:36** soon after starting a 15-minute match. Not looked into.
- Josh's hand checks, once the demo works to his liking: pointer lock (Esc opens the menu), and the host's tab in
  the background mid-match.

## One look everywhere

Done on 2026-10-28 for the play app (`client/css/style.css`) and the shooter's in-game HUD; both use the website's
Blockout look and its two typefaces, which this server now hosts in `client/fonts/` for the app and every game frame.
Left: the starter template's colours, and the 3D worlds themselves (grey boxes on a flat green floor).

## Before showing friendslop to a real maker

- The Docs page on friendslop.us still says "Coming soon". The homepage's "Make your first game"
  section has the agent prompt and the steps meanwhile.
- The two "Next" items above (traffic and the first-host timeout).

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
