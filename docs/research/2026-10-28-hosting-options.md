# Hosting: ways to stop carrying every room ourselves

Research, 2026-10-28. Nothing here is decided or built. Prices and limits are as each provider's own
page stated them on 2026-10-28, and anything not confirmed on a provider's own page says so.

## The problem

friendslop tells makers that hosting is easy. Today that is true only because play.friendslop.us
carries every room on Render's free plan: 5 GB of outbound data a month, which we cap at
`DAILY_TRAFFIC_MB` = 150 a day.

Games shared by link already run their rules in the host's browser, so the server runs no game code.
What it still does is carry the game's messages. The host's browser sends each message to the
server once (`client/js/frame-host.js`), and the server sends a copy to every player in the room
(`#out` in `server/remote-match.js`). Those copies are almost all of our outbound data. In a 10 v 10
Control Points match each player receives about 0.22 MB a minute, packed, so 150 MB a day covers
about 690 player-minutes: one full room for about 35 minutes.

Josh, 2026-10-28: don't copy game-night's mechanic (each group runs it from its own Google Sheet and
Apps Script), because it risks breaking Google's terms. Look for hosting ideas that weren't
considered before. Already considered in the hosting design
(`docs/superpowers/specs/2026-10-26-game-hosting-design.md`): a card on file at Render ($0.15 per GB
past 5 GB) and Oracle Cloud's free VM (10 TB a month).

One thing to know whatever we choose: Render's own page says its free instances are not for
production ("Do not use them for production applications", https://render.com/docs/free). It
reads as advice and stops short of forbidding it, but play.friendslop.us is a production site on it
today.

## Recommendation: let the host's browser carry its own room

**The idea.** The host's browser already runs the game, so let it send the game's messages to each
player directly over WebRTC data channels. The server stays the room's front desk: it introduces
the host and each player (the WebRTC "signaling", a few small messages over the WebSocket that
already exists), and it keeps everything it keeps today: the lobby, passwords, chat, teams, scores,
stats and results. Only the game's own messages move.

This makes the promise true in the way game-night does, without anyone's Google account: every room
brings its own bandwidth, from the host's internet connection. A busy evening of rooms costs our
server about the same as a quiet one.

**What moves where.**
- The host's friendslop page (trusted friendslop code, outside the game's sandboxed frame) opens
  one data channel to each player and does the fan-out that `#out` does on the server today: to
  all, to a team, to one player, or to all except one.
- Each player's page sends its game messages to the host over its channel instead of to the server.
- `ctx` items (stats, team scores, team changes, chat announcements, ending the match) still go to the
  server, which checks them exactly as it does now.
- The game frame doesn't change. It never touches the connections, so the fence stays as it is.
- The host's page has to check what players send it (size, rate, shape), the way
  `server/connection.js` does now.

**When a player can't connect directly.** Some networks block direct connections (strict home
routers, mobile carriers, offices). The only measured figure found is old, from video calls in 2015
and 2016: 22% needed a relay (https://webrtchacks.com/usage-stats/). Vendor estimates run from 10% to
25%. Those players carry on through our server exactly as today, with nothing for them to do. If 10%
to 25% fall back, 150 MB a day covers about 2,700 to 6,800 player-minutes instead of 690: four to ten
times as much, with no new account and no new bill.

**What it costs.**
- **The host's upload.** In a 10 v 10 room with 19 other people, packed, the host sends about 0.55
  Mbit/s of game data, and about 1 Mbit/s with packet overhead (my estimate). Most home connections
  can do that. Without packing it would be about 4.3 Mbit/s, which many can't, so the host's page
  needs to pack. The server packs with zlib's sync flush (`server/packer.js`). As far as I know,
  the browser's own `CompressionStream` can't flush between messages, so the host's page would need a
  small deflate library. Needs checking.
- **Ordered channels.** Packing needs every message in order, so these channels would be ordered and
  reliable, like the WebSocket today. Unordered channels (good for a shooter) are supported in every
  major browser since 2020 (MDN, `createDataChannel`), but they would have to go without packing.
  That's a later choice.
- **IP addresses.** This is the real decision. With a direct connection the host's browser and each
  player's browser can see each other's IP address (W3C WebRTC spec, https://www.w3.org/TR/webrtc/).
  The README says today that players never connect to each other and friendslop never shows one
  player another's address. Games shared by link can already see addresses, and the first-look
  warning says so, but this would be friendslop itself doing it. Choices:
  1. Direct connections for everyone, said plainly on the first-look warning and the privacy page.
  2. The host ticks "direct connections" for the room, and everyone else goes through our server as
     today.
  3. Each player chooses, and the default is through our server.
  4. Never direct. Then this option saves nothing, unless a relay carries it (below).
- **STUN.** Browsers need a STUN server to find a direct path. Cloudflare documents
  `stun.cloudflare.com` as "free and unlimited" (https://developers.cloudflare.com/realtime/turn/faq/).
  Google's `stun.l.google.com` is widely used, but I found no Google page offering it to other sites,
  so it's out under Josh's terms rule.
- **Building it.** Medium to large: a second transport in `client/js/frame-host.js`, the fan-out
  copied from `server/remote-match.js` into the host's page, signaling messages in
  `shared/protocol.js`, fallback when a channel fails, and tests. The game API and every game stay
  the same.

**Check before building.** A one-evening spike: two or three real people on different networks,
one host, and a page that counts how many connected directly and what the host's upload looked like
in a full room.

## Also worth knowing

**Free TURN relays.** A TURN relay carries the players who can't connect directly, and with
"relay only" it hides each side's IP address from the other (choice 4 above). Two have big free
allowances, and both have a terms question:
- Cloudflare Realtime TURN: the first 1,000 GB a month free, then $0.05 per GB
  (https://developers.cloudflare.com/realtime/pricing/). It needs a Cloudflare account and a key
  that our server holds to issue short-lived logins. But Cloudflare's service terms say Realtime is
  for "video call functionality" (https://www.cloudflare.com/service-specific-terms-developer-platform/,
  updated 2026-09-28), so game data may not be allowed. One of its own pages also says the free
  allowance applies only alongside its video service. Ask Cloudflare in writing before using it.
- ExpressTURN: 1,000 GB a month free (https://www.expressturn.com/), but the free plan uses one fixed
  login that every player's browser would see, and nobody has read its terms yet.

Neither is needed for the recommendation: without TURN, the players who can't connect directly use
our server.

**A Cloudflare Durable Objects relay.** Cloudflare's free Workers plan includes Durable Objects,
which can hold WebSockets. It doesn't charge for outbound data. It counts requests: 100,000 a day,
with incoming WebSocket messages counted 20 to 1 and outgoing ones free
(https://developers.cloudflare.com/durable-objects/platform/pricing/). At about 20 incoming messages a
second per player, that's about 1,700 player-minutes a day, 2.4 times what Render gives us. Past the
limit Cloudflare fails requests mid-game, so the relay would have to stop new rooms first. Moving to
it means rewriting the server for Workers, which is much more work than the recommendation for a
smaller gain. It could matter later in two ways: as the fallback relay instead of Render, or as a
"Deploy to Cloudflare" button (https://developers.cloudflare.com/workers/platform/deploy-buttons/)
that lets a maker whose game outgrows the shared server run the relay on their own free account. The
terms bar "virtual private network or other similar proxy services" (https://www.cloudflare.com/terms/,
2.2.1(j)). A game room is unlikely to count, but it's broad enough to ask.

**Fewer bytes per game.** Control Points ticks at 30 a second (`tickRate` in `games/cp/server.js`) and
broadcasts a snapshot each tick. Sending snapshots 15 times a second and smoothing between them would
roughly halve the traffic on any of these options. That's a game change. The platform stays as it is.

## Looked at and ruled out

| Idea | Why not |
|---|---|
| Each group runs it from its own Google Sheet (game-night) | Josh: Google terms risk |
| Signaling or relaying over public MQTT brokers, Nostr relays or BitTorrent trackers (the Trystero library) | Every operator that says anything calls it testing only (test.mosquitto.org, HiveMQ, EMQX); the rest state nothing. We don't need them: our own server can do the signaling |
| The host's PC through a Cloudflare quick tunnel, for real use | Cloudflare: "intended for testing and development". `npm run tunnel` stays as a testing tool |
| ngrok free | 1 GB a month |
| Tailscale Funnel | Allowed, but the host has to install it |
| A browser as a public server | Not possible with standard web features; only WebRTC between browsers |
| Message services: Ably, Pusher, Supabase Realtime, Azure Web PubSub | Free tiers cover roughly 30 to 180 player-minutes a day |
| Firebase Realtime Database | Built for syncing data. Its 360 MB a day would cover about 1,600 player-minutes, but its 100 connections are five full rooms |
| Google Cloud Run | 1 GB a month free, and it needs a billing account |
| Fly.io, Koyeb | No free tier for new accounts any more |
| Deno Deploy | Deno announced on 2026-10-09 that it will shut down in about six months |
| Photon's free 20-user tier | Non-commercial only |
| Hathora | Reported shut down in May 2026 (third-party report, not confirmed) |
| Several free accounts at one provider to add up allowances | Most providers' terms forbid it (not checked one by one) |

## For Josh to decide

1. Whether to try the host-carries-its-room idea, starting with the one-evening spike.
2. Which of the four IP address choices friendslop should make.
3. Whether to ask Cloudflare in writing about game data on its free TURN, and about Workers for a
   game relay. Josh would create the account and send the question.

## Sources

The three research notes behind this, with every link, are kept locally in
`.superpowers/research/2026-10-28-hosting/` (git-ignored): WebRTC and TURN, hosted relays and their
free tiers, and less usual ideas. The links that matter most are inline above.
