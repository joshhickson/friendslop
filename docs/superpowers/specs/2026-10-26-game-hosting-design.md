# Getting games onto friendslop.us

Design, 2026-10-26. Status: waiting for Josh's approval.

## Why this exists

The person this is for has vibecoded a small multiplayer game and wants their friends playing it
tonight. They might be 18 or 38. They might code a little, a lot or not at all. Hosting is what
stops them: they don't know the steps, or the steps scare them. They know the game isn't amazing.
They want it out there to see if people like it, and they might be on their way to making
something more polished one day. They probably found friendslop because their AI assistant
recommended it, and that assistant often does the technical work for them.

The homepage promises that anyone can host a lobby just by visiting the site, with no download.
This design keeps that promise for every game, including ones nobody has reviewed.

Josh wants to review a game before it is associated with his platform, through a pull request. He
does not want that review to stand between someone and a working link.

## What success looks like

- A stranger with a game in a GitHub repo pastes one link into friendslop.us and has a room link to
  send their friends, within minutes, without Josh doing anything and without paying for anything.
- Josh reviews submissions when he has time, and nobody is stuck waiting on him to play.
- A game Josh has approved gets its own address on friendslop.us.
- Everything a player or a submitter reads is funny.

## Goals

- **An instant, free, working link for any game,** with no download for the host or the players.
- **A pull request review that decides what gets listed** on friendslop.us.
- **Listed games get a nice address:** `friendslop.us/<game>`. A listing page can also link out to the
  maker's own site, so it works as a landing page for them. Starting rooms from the maker's own
  domain, or embedding play.friendslop.us there, is later.
- **Josh's server never runs a stranger's code.** It only relays messages.
- **It fits Render's free plan** for the first months: 5 GB of outbound data a month.
- **A web professional could pick this up** from this document without having been in the
  conversation that produced it. Josh may bring one in.

## Non-goals

- **Catering to people who fork and self-host.** They are welcome, and nothing stops them, but
  nothing here is built for them.
- **Accounts, profiles, a game directory with search, ratings or comments.** These are open
  questions for later, possibly for the web professional.
- **Moving the host role** to another player when the host leaves. Later.
- **Subdomains** like `their-game.friendslop.us`. Later.
- **Uploading a game without GitHub,** for example by dragging a folder onto the page. Later.
- **Scale.** Josh expects almost no traffic in the first month.

## Anti-goals (it fails if any of these are true, even if it works)

- Someone has to wait for Josh before their friends can play.
- An unreviewed game can read anything belonging to friendslop.us or another player, such as saved
  sessions, or can affect any room except its own.
- Anything the fence can't stop, or anything the host can do, is left unsaid to players.
- Josh gets a surprise bill, or Render suspends the site partway through a month.
- Anything a player or submitter reads sounds like a corporation wrote it.
- A joke hides information. Every message still says what happened and what to do next.

## Decided by Josh

- **Unreviewed games get an instant link: the host's browser runs the game, and the server only
  relays messages.** Josh chose this because it is closest to what the homepage advertises.
- **A pull request review comes before a game is associated with the platform.**
- **Forks and self-hosting are fine** and need no support.
- **People who don't want to pay for a domain still get a good address.** Josh named a subdomain, a
  path like `friendslop.us/your_game_here`, or a link through to the maker's own domain as the
  options.
- **It has to be funny.** In Josh's words: "Just make sure it's funny since we're being so anal
  about this."
- **The fence is best effort, and that is disclosed.** An unreviewed game may be able to contact an
  outside server and see players' IP addresses, the way any website can. Josh accepted this
  (2026-10-26: "Accept and disclose both"). Players are told before an unreviewed game first loads.
- **The host can cheat, and that is disclosed.** The host's browser runs the game, so the host can
  change scores and controls the lobby bots. Josh accepted this in the same message. The two
  promises on the site that this breaks get rewritten.
- **Traffic will be near zero at first,** so Render's free plan is enough. A card on file at Render
  ($0.15 per GB past 5 GB) or Oracle's free VM (10 TB a month) are the ways out if it grows.

## Claude's calls (Josh asked Claude to decide these; he can overrule any of them)

- **Games come from GitHub.** A maker pastes a link to a game folder in a public GitHub repo, which is
  usually a fork of friendslop. The files load from jsDelivr, a free public CDN that serves GitHub
  repos, pinned to one commit.
- **Every game runs the same way,** reviewed or not. The review only changes whether the game is
  listed. There is no second, trusted way of running games on the public server.
- **Unreviewed games show a banner** that names the repo and has a report link. Josh can block a
  repo.
- **Listing is a pull request that adds one small file,** `listings/<game>.json`, which pins the
  exact commit Josh reviewed.
- **Listed games live at `friendslop.us/<game>`** first. Links to the maker's own domain come with the
  listing. Subdomains wait.

## How it works

### What runs where

Today the server runs everything: rooms, the lobby, and each game's `server.js`. This design splits
that into a trusted part and an untrusted part.

**Trusted, stays on the server (the code that exists today):** rooms, passwords, the lobby, teams,
chat, team scores, player stats, results, reconnects, rate limits and the traffic budget.

**Untrusted, moves to the host's browser:** the game's `server.js` (its rules and its tick loop) and
every player's copy of the game's `client/index.js`.

- On the **host's** computer, a fenced-off frame runs the game's server hooks and the host's own copy
  of the game client.
- On a **friend's** computer, the frame runs only the game client.
- The server passes game messages between players' frames and the host's frame. It never loads or
  runs game code.

### The game API stays the same

The `defineGame` and `ctx` API (see `docs/making-a-game.md` and `templates/starter/`) stays the same.
File paths are allowed to change (Claude's call): today the client kit is imported from absolute
paths like `/client/kit/index.js`, and assets live at `/games/<id>/assets/...`. Inside the frame,
imports go through the frame's import map, and asset URLs are built from `import.meta.url` so they
resolve inside the pinned commit. The starter template and `docs/making-a-game.md` change to match.
This costs nothing now because no games are published yet. A **game runner** in the host's frame implements `ctx` and calls
the game's hooks exactly as `server/match.js` does today.

- `ctx.send`, `ctx.broadcast` and `ctx.sendTeam` become relay messages to the server, which delivers
  them to the right players as ordinary game messages.
- `ctx.players()`, `ctx.getPlayer()`, `ctx.stat()` and `ctx.teamScore()` read from a copy of the room
  that the server keeps up to date in the host's frame.
- `ctx.setStat`, `ctx.addStat`, `ctx.setTeamScore`, `ctx.addTeamScore`, `ctx.setTeam`, `ctx.announce`
  and `ctx.endMatch` become requests to the server. The server checks each one: it must come from
  the host, for the host's own room, and name real players and teams. Then the server applies it,
  so scoreboards and results work as today.
- Players' game messages go to the server, which forwards them to the host's frame along with who
  sent them. Join, leave, team change and spectate events are forwarded the same way.
- Lobby bots (the ones the host adds) run inside the host's frame. The server still lists them as
  players, so the lobby, teams, stats and auto-fill work as today, but the host's frame controls them
  and their messages never cross the network. External bots, meaning outside programs that join with
  the room code and password, stay real players over WebSocket.

The tick has to keep running when the host switches tabs, because browsers slow timers in
background tabs. The game runner probably needs a Web Worker for this; that is the builder's call.

### The fence around game code

Game code is untrusted, whether it is a game's client or its server hooks.

- It runs in an `<iframe sandbox="allow-scripts allow-pointer-lock">`, **without** `allow-same-origin`.
  The frame gets an origin of its own and cannot read friendslop.us storage, cookies or pages.
  Fullscreen, autoplay and gamepads need the frame's `allow` attribute; the builder checks which
  games need what.
- The frame's page is served by friendslop with its own Content Security Policy. It may load scripts,
  images, audio and data from `cdn.jsdelivr.net` only. This stops ordinary requests, but it is best
  effort: a frame can still navigate itself to another address, and WebRTC can reach outside
  servers and reveal a player's IP address. The friendslop page should notice a frame that
  navigates away and remove it.
- **The first time a player opens an unreviewed game,** they see one click-through screen saying the
  game isn't reviewed and, like any website, can see their IP address. Their answer is remembered
  per game on the friendslop page, outside the frame. Listed games skip it.
- The frame talks to the friendslop page only through `postMessage`. The friendslop page checks every
  message: it must come from that frame, have a known shape and stay under the size limit. The
  friendslop page owns the WebSocket.
- The server limits relay messages by size and rate, the way it limits player messages today, and
  counts them toward the daily traffic budget.
- The frame has no `localStorage`, because its origin is opaque. A small storage API through the
  friendslop page can come later.

One risk stays: a game can show anything on screen, including a fake login box. The banner and the
report link are the answer for month one.

### Loading a game from GitHub

- A maker pastes a link like `https://github.com/<user>/<repo>/tree/<branch>/games/<game>`.
- friendslop resolves the branch to a commit, through jsDelivr's data API or GitHub's API.
- Files load from `https://cdn.jsdelivr.net/gh/<user>/<repo>@<commit>/games/<game>/...`.
- A game's relative imports, such as `../../server/kit/index.js`, resolve inside the same pinned
  commit. That is why the repo has to have friendslop's layout, which a fork gives it.
- three.js loads from jsDelivr's npm mirror at a pinned version, through the frame's import map.
- Because the commit is pinned, the host and every friend run identical code. jsDelivr keeps commits
  cached even after the repo changes or disappears, so a listing keeps working.

Limits, from jsDelivr's own documentation (checked 2026-10-26):
- The repo must be public.
- No single file over 20 MB, and no more than 150 MB per repo version.
- jsDelivr serves HTML as plain text, which is fine here because friendslop serves the frame page.
- jsDelivr's terms forbid using it as general file or media hosting, but they name "apps, or games
  with a large number of assets" as legitimate.

The game runner and the game share a small, versioned protocol. A game whose fork is too old to
work gets a clear, funny message telling the maker to update their fork.

### The instant link (no review)

1. The maker opens friendslop.us, pastes the GitHub link and clicks Host.
2. They get the usual room link, `play.friendslop.us/?room=<code>`, and send it to friends.
3. Everyone who opens it sees the lobby, then the game with the unreviewed banner across the top.
4. When the host leaves, the match ends for everyone and the room goes back to the lobby.

The banner names the repo and the maker, and links to a report. A report opens a GitHub issue on
the friendslop repo, prefilled with the repo link, so month one needs no reporting backend. Josh
can block a repo by adding it to a blocklist file in the repo. A blocked repo refuses to load, with a
message.

### Getting listed (Josh's review)

1. The maker opens a pull request that adds `listings/<game>.json`. Its fields: the game's slug, its
   title, a one-line blurb, the repo, the folder path, the pinned commit, the maker's name, and an
   optional link to their own site.
2. An automatic check runs on the pull request. It checks the file's fields and confirms the game at
   that commit loads and defines a game. It does not judge whether the game is any good. That part is
   Josh's.
3. The pull request template links to the code at that exact commit, so Josh reviews precisely what
   will run.
4. When Josh merges it, a build step generates a static page at `friendslop.us/<game>`. The page has
   the title, the blurb, the maker, and a Host button that opens play.friendslop.us with that pinned
   game. These pages are served by GitHub Pages, so they cost nothing against Render's data.
5. A listed game shows no unreviewed banner. Its credit strip says who made it.
6. An update is a new pull request that changes the pinned commit. Josh removes a listing by deleting
   its file.

### Where things live

- `friendslop.us`: the GitHub Pages site (the `joshhickson/friendslop.us` repo). It holds the teaser,
  the paste-a-link box, and the generated listing pages.
- `play.friendslop.us`: the Render server (the `joshhickson/friendslop` repo). It holds the lobby and
  the relay, and serves the frame page. With everything heavy on jsDelivr and GitHub Pages, Render
  mostly carries game messages.

Which repo holds `listings/` and the build step, the site repo or the platform repo, is the builder's
call.

### What changes from the code that exists today

- **`server/match.js` stops running hooks on the public server.** Its `ctx` becomes the basis of the
  game runner in the frame.
- **The client's match screen** loads the game into the frame instead of importing it from `/games/`.
- **`render.yaml`** no longer needs a `GAMES_DIR` for the public server. Whether local `npm run play`
  keeps running games on the server, or moves to the frame too, is the builder's call. Self-hosters
  are not catered to either way.
- **The existing limits and the traffic budget stay.** Relay messages count toward them.
- **Copy that stops being true gets rewritten, and Josh sees the new wording before it is
  published:**
  - `friendslop-site/index.html`, the "The server keeps score" item: "nobody wins by editing their
    browser".
  - `friendslop-site/bots/index.html`, the "One door for everyone" section: "a bot can't cheat any
    more than a player can".
  - The `friendslop` README and `docs/` wherever they say the server keeps score or bots are real
    players, plus a short honest note on what the fence does and doesn't stop.
- **The existing tests stay** wherever the code they test stays. New tests cover the relay checks
  and the frame messages.

## Voice

The product is called friendslop. It should act like it. Every message keeps its information and
adds a joke. Jokes are aimed at the situation, at friendslop, or at the internet, and never at the
maker's game. Errors still say what went wrong and what to do.

Josh's prose rules apply to everything a player reads: hyphens only, never an em or en dash, and no
sentence that depends on a dash.

Starting points (the builder and Josh will rewrite these):
- Unreviewed banner: "Nobody at friendslop has played this yet. It could be a masterpiece. It could
  be three cubes and a dream. Made by {maker} ({repo}). Report it"
- Host left: "The host left and took the whole game with them. Bold move. Back to the lobby."
- Over the data budget: "friendslop has used up today's internet. New games can start after
  midnight UTC. Matches already running can finish."
- Idle room closed: "Everyone went quiet, so we closed the room. No hard feelings."
- Fork too old: "This game was built with an older friendslop, and they no longer speak the same
  language. Ask its maker to update their fork."
- Blocked repo: "This game has been retired from friendslop."
- First look at an unreviewed game: "Heads up: nobody has checked this game. Like any website, it can
  see your IP address. It probably just wants to show you some cubes. Play anyway?"
- Host can cheat: "The host's computer runs the game, so the host could change the score. Choose
  your friends carefully."
- Pull request template opener: "Thanks for submitting! One human reviews every game, so this might
  take a few days. That human has a day job and opinions."
- Pull request checklist: "My game runs." "My game is not malware." "I understand that 'it's a
  feature' is not a reply to a bug report."

## Constraints

- Render's free plan: 5 GB outbound a month, incoming data free, and the free instance sleeps after
  15 minutes without traffic. Past 5 GB without a card, all free services are suspended for the
  rest of the month (render.com/docs/outbound-bandwidth, render.com/docs/free).
- jsDelivr's limits and terms, above.
- Josh creates every account, at Render, GitHub or anywhere else.
- Josh will change the code significantly before publishing.
- So it is built and tested locally first (Claude's call). Tests use a local stand-in that serves a
  repo folder at jsDelivr-shaped URLs, and a local stand-in for resolving branches. The real
  jsDelivr, the pull request check and the GitHub Pages generator get their first real run once
  Josh publishes.

## Left to the builder

- The relay message format, its size and rate limits, and how it is versioned.
- Whether the game runner uses a Web Worker, and how it schedules ticks.
- How branch links resolve to commits, and how errors from GitHub or jsDelivr are shown.
- The exact `listings/` file format, the automatic check, and the page generator.
- The frame's `allow` list, and how the frame's page and its CSP are served.
- Where `listings/` lives.
- The UI for pasting a link and hosting.

## Open questions for later

- Accounts, a game directory, ratings, and moderation beyond a blocklist.
- Moving the host role when the host leaves.
- Subdomains for listed games, and pointing a maker's own domain at a listing.
- Uploading a game without GitHub.
- How deep the automatic pull request check should go.
- Storage for games, such as saved settings.
