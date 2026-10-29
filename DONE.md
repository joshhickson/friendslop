# Done

Finished work, newest first, with the details worth keeping. What's still open is in
[TODO.md](TODO.md).

## 2026-10-28: hosting research, the demo button, a Windows fix

- Hosting options researched: [docs/research/2026-10-28-hosting-options.md](docs/research/2026-10-28-hosting-options.md).
- A first critique of the site's look: [docs/research/2026-10-28-site-look-critique.md](docs/research/2026-10-28-site-look-critique.md).
- play.friendslop.us's home screen has a "Play the demo" button (not pushed yet).
- On a Windows checkout the server hashed `client/index.html`'s import map with its CRLF line
  endings, but browsers hash it with LF, so the page's own CSP blocked the import map. The server
  now hashes it the way browsers do. The live site, on Linux, was never affected.

## 2026-10-28: privacy

- friendslop.us/privacy says what both sites collect, how long it's kept, and who else is in the
  path. Every site footer and the play.friendslop.us home screen link to it.
- The server no longer writes the room creator's IP address to its log. The IP is still used in
  memory for rate limits and password lockouts.
- friendslop.us serves its two typefaces from its own `fonts/` folder (the same files as this
  repo's `client/fonts/`), so no page loads anything from Google.

## 2026-10-28: the session plan, four batches

Josh agreed the plan, with a push after each batch.

1. The slow first host waits up to 45 s with a "still loading" note, the capture bonus flashes on
   the clock, the starter template is in the Blockout look, and the server logs what compression it
   got.
2. Packed messages, live and measured (below).
3. Bot matches keep moving (below), the bonus rule (only captures in the enemy's half add time, Josh
   approved), and Control Points' 3D world in the Blockout look.
4. The Docs page on friendslop.us, the `/ws?z=1` line on the protocol page, and the site review
   fixes (below).

## 2026-10-28: packed messages

Render's proxy drops the browser's offer of WebSocket compression on the way in, so the app
compresses for itself: the browser connects to `/ws?z=1` and the server sends one deflate stream per
player (`server/packer.js`, unpacked by `client/js/unpack.js`). Checked live in a 10 v 10 Control
Points match on play.friendslop.us: Render logged `packed messages: yes`, a packed probe player
received 0.217 MB a minute and a plain one 1.709 MB. At that rate the 150 MB a day covers about 700
player-minutes instead of about 90.

## 2026-10-28: one look everywhere

The play app (`client/css/style.css`), the shooter's HUD, the starter template's board, and Control
Points' 3D world (paper-grey blocks outlined in ink, a graph-paper floor, orange crates) all use the
website's Blockout look and its two typefaces. This server hosts them in `client/fonts/` for the app
and every game frame.

## 2026-10-27 and 28: the Control Points demo

Josh, 2026-10-27: spruce it up and serve it as a working demo with bots that play. It runs from a
link with virtual bots, the unreviewed banner can be closed, and the UI and 3D world are in the
Blockout look.

Bot matches used to stall. A fast-forward simulator of bot-only matches
(`.superpowers/tools/sim-cp.mjs`, local only: the real game and bot code in the real runner on a
virtual clock) showed that in 8 matches the front stuck at C for 6 to 16 minutes, with about 3
captures a match, and red won all 8. Three causes, all fixed 2026-10-28:

- Bots picked their door in each wall from a seed, so the teams spread unevenly. Now they pick by
  team slot.
- A push waited for 60% of all living teammates at the staging spot, defenders included, so it never
  filled and always went on the timeout. Now it counts attackers only.
- 4 of 10 bots sat on a point nobody threatened. Now 2 do.

After those, matches swung C back and forth about 45 times and never ended, because every capture
added a minute. Now only a capture in the enemy's half adds time. Then 12 normal and 8 easy or hard
matches: 17 to 31 captures, all ended between 15:00 and 17:02, longest quiet stretch 3:37, red 11,
blue 6, draws 3.

## 2026-10-27: site review

No page said the demo was live or linked to it, the Docs page said "Coming soon", and the games,
roadmap, bots, jam and protocol pages were behind. Fixed in site commit ab06d70: a Play the demo
button at the top of the homepage, a real Docs page, every page brought up to date, and listing a
game is an issue everywhere.
