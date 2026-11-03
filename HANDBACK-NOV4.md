# Handback: friendslop, Nov 4 portfolio work

Session of 2026-11-02, about 11:40pm to midnight PST. Branch `portfolio/nov4`, made from `main`
(`d157dd9`), which the November audit names as the current code; the audit branch only adds the
audit file. Pushed to GitHub. Nothing was merged, published, deployed, posted or sent, and no one was
contacted. `main` is untouched, so the live game site hasn't changed.

---

## Waiting on you, most important first

### 1. Nov 7: Halo Wars 2 can't run on friendslop. What did you mean?

I checked the repo's note and agree with it. Plainly:

- **Halo Wars 2 itself can't run in friendslop.** Microsoft owns the code and the art, there's no
  source to work from, and it's a Windows/Xbox program, not a browser game. Rebuilding it would be a
  copy of a specific game, which none of us should make.
- **You don't need friendslop for a Halo Wars night.** Halo Wars 2 already has online co-op, including
  Terminus Firefight, on Xbox and Windows (fan and store sources; nobody has checked by playing). The
  note says no mod is needed for that. Your Nov 1 answer expected it would need modding; the research
  says it doesn't.
- **An original game "similar to" Terminus can be built on friendslop:** a 3D co-op base-defence game
  against waves, with its own name, units and art. The kit has the 3D, rooms, teams, bots and
  pathfinding. But nothing like it exists yet: the demo is a shooter, not a strategy game.
- **By Nov 7?** It competes with the portfolio until Nov 4 EOD, which leaves about two and a half
  days. A small, rough prototype (one map, a few unit types, waves, 1 to 3 players) is possible as a
  stretch. A polished one isn't, and nobody would have played it before your friends do.

**Decide:** (a) a night of the real Halo Wars 2, no build needed; (b) an original friendslop game in
that style, rough; or (c) something already working for Nov 7 (the Control Points demo, or the trivia
game on your machine) with the 3D game after. Also: may the page name Halo Wars as the inspiration?

### 2. The demo banner: confirm the demo, then a yes to go live

You said to remove the banner from the one demo you've signed off on. The only game this repo calls
"the demo" is **Control Points** (the "Play the demo" button), so that's the one I did. Please
confirm. If you meant another game (the NES spike, the trivia game, a reality-check game), say which.

- Done on this branch only: Control Points no longer shows "Nobody at friendslop has played this
  yet..." Every other game, including copies of Control Points in other people's repos, still does.
- Checked in a real browser on a local server (banner gone for the demo, still there for another
  repo's copy) and with two new tests. All 144 tests pass.
- **It isn't live.** Going live means merging to `main`, which redeploys play.friendslop.us. That needs
  your yes, and I didn't merge.
- **A related call:** before the demo loads, a one-time warning still says "Heads up: nobody has
  checked this game. Like any website, it can see your IP address..." The first half is no longer true
  for your demo; the second half is a real privacy notice. Keep it, reword it for signed-off games, or
  skip it for them?

### 3. Four questions for the page, in your own words

From `handoff/friendslop-page.md`. Each has a draft or a fallback, so the page works without them:

1. "In one or two sentences, why did you start friendslop?"
2. "How do you want to say that nobody outside has played it yet, in your own words?"
3. "Is Nov 7 an original co-op game or a night of the real Halo Wars 2, and may the page name Halo
   Wars?" (Same as item 1 above.)
4. "Roughly what did friendslop cost, in money and in hours?" Known: hosting and the game file CDN are
   free plans. Not known: AI costs, the domain, your hours.

### 4. Word-for-word quotes are still undecided

You answered "decide later". So the page doesn't quote anything you typed to agents, including your
Nov 2 line about not yet having built something people use. If you say yes, it can go in question 2.
I also removed a word-for-word quote of you from the public repo for the same reason.

### 5. The removed notes are still in public history

I deleted the process notes in your name, local paths and other people's handles from what visitors
see on this branch. But:

- They're still readable in the git history of `main` and every branch. Scrubbing them means
  rewriting public history: your call, not done.
- Five other public branches (`reality-check-demo`, `reality-check-casino`, `spike/nes-lockstep`,
  `analysis/portfolio-2026-11`, `audit/2026-11`) still have older copies with local paths and "how Josh
  works" notes. On the two reality-check branches your answer was "decide later, save them first". I
  didn't touch any of them.

### 6. Reopening the two analysis sessions: not done

You asked to reopen the friendslop and terrain-glow analysis sessions and wanted a timestamp.
**As of 2026-11-03 07:55 UTC (11:55pm PST, Nov 2), this session has not reopened either one.** This
job was limited to this repo, and contacting other sessions wasn't in it. It's recorded in the ledger
as open (A1).

### 7. The rest, from TODO.md

Hand-check pointer lock and a background host tab; play the demo with friends and write down what
happened; the three hosting questions; the design plugins; how visitors suggest game ideas; a test
email to your contact address from another account.

### 8. Small things to know

- **Branch name:** this cloud session was set up for a branch called `claude/portfolio-nov4-i2q2m7`.
  You asked for `portfolio/nov4`, so I used that. The other one already existed on GitHub before I
  started; I didn't push to it.
- **The live server, read only:** at about 07:50 UTC on Nov 3 it showed 0 rooms and 0 players. The
  Firefox fix and the "Play the demo" button are both live (checked: the frame's security header and
  the served code).

---

## What I did

1. **Read the audit in full** (`AUDIT-2026-11.md`), ran the ledger brief, and checked it before
   starting.
2. **Demo banner:** `shared/signed-off.js` lists signed-off games (Control Points only); the match
   screen skips the banner for them. Tests in `test/signed-off.test.js`. The README's security section
   says so.
3. **TODO.md brought up to date:** the Firefox fix and demo button marked as pushed and live, the NES
   spike marked as pushed; new items for the signed-off demo, the Nov 7 test, counting real use, the
   empty "Create room" tab and the public branches; working notes cut to what's not personal. `DONE.md`
   got a Nov 2 entry and its stale "not pushed" lines fixed.
4. **Deleted the process notes in your name:** the design spec and build plan (`docs/superpowers/`),
   "How Josh works", the contact-email testing notes, and the notes on your friends and your phone in
   the modded-games note (its research stays, with a new section on Halo Wars).
5. **Tidied what visitors see:** local folder paths, the local tools folder, the host service's
   address and the registrar out of the docs; three other developers' handles replaced by project
   names; "Josh said..." lines made neutral.
6. **Hand-off for the website session**, in `handoff/`: page text in your voice, three web-sized
   screenshots with their source, links, and a privacy note.
7. **Recorded your Nov 1 to 2 answers in the shared ledger.** New: D20 (banner), D21 (Nov 7), D22
   (delete process notes), D23 (reality-check branches), F2 (not yet played with friends), F4
   (he/him), A1 (reopen sessions). Seven others were already there; I added them again by mistake and
   then marked my copies as duplicates (D19, D24, D25, D26, D27, F3, Q3). The originals stay in force.

## What I checked, and how

- **Tests:** `npm test` on the branch: 144 of 144 pass (142 before, plus my 2).
- **The banner in a browser:** a local server, the demo hosted by its GitHub link with 19 bots, a full
  match started; the banner was gone. Same steps with another repo's copy: banner shown.
- **The live site (read only):** the health endpoint, the frame's security header for the Firefox fix,
  the served home-screen code for the demo button, and that friendslop.us, its privacy page and two
  commit links answer.
- **Privacy:** a search of every file on the branch for paths, handles, emails, IP addresses, service
  names and every mention of "Josh", each hit read; credential files: none tracked, none opened;
  screenshots looked at in full and saved without metadata. Details in `handoff/privacy-note.md`.
- **Not checked:** how the game feels to play by hand, anything on friendslop.us beyond it answering,
  the Halo Wars facts (fan and store sources from the earlier note), and the trivia branch (it's only
  on your machine).
