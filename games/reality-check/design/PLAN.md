# Reality Check (casino): build plan

This file is for Claude, not for players. It survives context compactions and new sessions. If anything you
remember disagrees with this file or with the code, trust the code first, then this file, then memory.

## How to use this file

1. **Starting or resuming:** read this whole file, then `RULES.md` in this folder (once it exists), then the
   Session log at the bottom. Pick up the first unchecked task in **Status**.
2. **While working:** tick a task (`- [x]`) as soon as it is done and verified, and add one line to the Session log.
   Record any rule change in `RULES.md` (its Decision log) in the same commit as the code that needs it.
3. **Before stopping, or when the context is getting long:** update Status and the Session log, commit, and push the
   branch (see Git rules). The next session has only what is committed.
4. **Never skip a phase gate.** Each phase ends with exit criteria. Do not start the next phase until they hold, or
   until Josh says to go on anyway (write that in the Session log).

## Status

Current phase: **1 (rules)**. Last updated: 2026-10-28.

- [ ] Phase 1: `RULES.md` with full rules, dial table and expected-value check
- [ ] Phase 2: rules engine, simulator, red-team, metric report (`sim/REPORT.md`)
- [ ] Phase 3: playable greybox prototype on friendslop, with logging, played with Josh's friends
- [ ] Phase 4: art (only after Phase 3 is fun)

Detailed task checklists are in each phase below.

---

## Context

### Who and how

- **Josh Hickson** owns both repos. He creates every account and decides every push to `main`.
- **Prose rules** (code comments, docs, UI text, chat replies): hyphens only, never an em dash or en dash, and no
  "this, not that" sentence shapes.
- **Ask Josh questions in plain text.** Do not use pre-written answer buttons (AskUserQuestion). He asked for this.
- **Show Josh the diff before any push to `main`,** and never open a pull request or merge without him asking.
  Work-in-progress pushes go to the branch `reality-check-casino` only (a stop hook in this environment asks for
  pushed commits, and branch pushes don't deploy anything: Render deploys `main` only).
- **Commits** are authored as `Josh Hickson <84687634+joshhickson@users.noreply.github.com>`:
  `git -c user.name="Josh Hickson" -c user.email="84687634+joshhickson@users.noreply.github.com" commit`.
  End each message with the attribution lines the environment's system reminder gives (currently a
  `Co-Authored-By: Claude ...` line and a `Claude-Session:` line). No model names anywhere in the repo.

### Repos and paths (cloud container; it is ephemeral)

- `joshhickson/friendslop` (push access): `/home/user/friendslop`, branch `reality-check-casino`.
  It was a shallow single-branch clone. If a remote branch ref is missing, add a fetch refspec:
  `git config --add remote.origin.fetch '+refs/heads/<b>:refs/remotes/origin/<b>'`.
  If the container is new and the folder is gone: attach the repo with the `add_repo` tool (access `push`), clone
  it to `/home/user/friendslop`, then `git fetch origin reality-check-casino` and check it out.
- `joshhickson/reality_check` (read only, public): `/home/user/joshhickson/reality_check`. The original design docs
  live in `docs/`. `lpc-generator/` is a full LPC sprite generator (top-down character sheets, walk cycles), useful
  in Phase 4. LPC art is CC-BY-SA and GPL: credit every asset (`lpc-generator/CREDITS.csv` lists authors).
- The earlier **card-game version** of Reality Check is on branch `reality-check-demo` (also `games/reality-check`).
  It is reference only and must never be merged: this casino version replaces it. Reusable from it: the fake-ctx
  test harness (`test/reality-check.test.js`), the balance-simulation approach, the Blockout CSS look, the bot
  pattern.
- Scratch files go in the session scratchpad directory, never in the repo.

### friendslop facts this game depends on

Read `docs/making-a-game.md` before Phase 3. The points that shape this design:

- A game is `games/<id>/server.js` (rules, authoritative) plus `client/index.js` (rendering, input), optional
  `bot.js` and `shared/`. A folder without `server.js` is skipped silently, so this folder can hold design docs,
  the engine and the simulator before the prototype exists.
- **Shared by a GitHub link, `server.js` and `bot.js` run in the host's browser in a Web Worker.** Relative imports
  only, no Node APIs (no `fs`), and the host could cheat (accepted; friendslop's banner says so).
  Run on your own server (`npm run play` or `npm run tunnel` with `GAMES_DIR` pointing at `games/`), `server.js`
  runs in Node.
- Limits: a client message is under 16 KB; the host relays at most 2000 deliveries a second (one per recipient), and
  a daily traffic budget applies on the public server. Per-player sends are fine at a modest tick rate (8 players at
  10 Hz is 80 deliveries a second).
- Kit helpers: `raycastBoxes`, `rayAABB`, `NavGrid` (pathfinding over a box world), `moveCharacter`, `History`,
  `Cooldown`, `Scheduler`, `clamp`, `isNum`. A top-down 2D game can use the x/z plane of the box world.
- Bots: a `bot.js` receives the same messages as a client and sends the same messages. Lobby bots run in the host's
  worker for link-hosted games.
- `ctx.endMatch({ winner, text })`, `resultsSeconds` for a custom ending, `ctx.setStat` for the Tab scoreboard,
  `ctx.log.info` for logging.
- Tests: `npm test` runs every `test/*.test.js` with `node:test`. All must keep passing after every task.

---

## How we got here (do not re-litigate without Josh)

1. **The card version (branch `reality-check-demo`) worked but was boring.** Roll a die, draw a card, apply numbers.
   Josh's diagnosis, which holds: the board was confusing, choices only affected yourself, and nothing persisted
   except a few numbers. Also: card choices showed exact numbers, so each was a math problem with a right answer,
   and every card was one-shot content (48 cards, each its own balance problem).
2. **The elevator-pitch test** (who are you, what do you do on your turn, why is it tense) killed the card game and a
   "town worker-placement" version. Secrets and exposure passed it, but Josh pointed out that secret games need a
   source of evidence: faces at a table, or space in a video game. Online, **space** is the evidence: you saw
   someone do it, or you were alone with them.
3. **Chosen direction:** a top-down spatial social game in the shape of Among Us, except nobody is assigned to be the
   impostor. Everyone is tempted and chooses when to cheat.
4. **Josh's pick of setting: the players work at a casino.** The casino is named **The Babel** (and "checks" is
   dealer slang for chips, so the title still works). One building, jobs as roles, cameras and the count room as
   built-in evidence.

**The pitch (keep it true):** "You all work the night shift at a casino. Everyone's skimming. The cameras see
everything, except when they don't." If a change makes this pitch false or needs a second sentence, stop and ask
whether the change is worth it.

### Decided

- Systemic design: a small set of **repeatable verbs**, varied by place, job, timing, witnesses and Babel events.
  Not authored one-shot content.
- Cheats (target set of 6, plus 1 casino special): **Skim** (palm chips from your station; hold longer for more),
  **Pickpocket** (lift chips from a drunk high roller or a coworker's tip jar), **Steal credit** (take a coworker's
  big tipper), **Bribe** (pay a witness or whoever is on security), **Frame** (plant chips in someone's locker, or
  post a fake photo), **Cover up** (wipe tape in the security office; take a phone and delete photos), and
  **Collusion** (a dealer deals a friendly hand to another player at their table; they split it).
- Honest actions: **Work** (your job's task), **Deposit** (bank your chips), **Photograph** (proof of what you see),
  **Accuse** (in the meeting).
- Jobs rotate each shift: dealer, cashier (the cage), bartender, security (cameras), valet. Each job has its own
  station, honest work and openings to cheat.
- Structure: a **shift** of play, then the **count** (missing money per station is tallied), then a **meeting**
  (accusations, proof, lies, a vote). Several shifts make a game. Babel events change the rules for one shift
  (payday fills the tills, a blackout kills the cameras, a whale arrives, a gaming commission inspector visits).
- Prototype first slice: **Skim and Pickpocket**, Photograph, the count and the meeting. Add the other cheats one
  per playtest, Bribe first.

### Open questions for Josh (do not decide these; build so either answer is cheap)

1. **The ending's flavor:** keep Heaven, Purgatory and Hell, or a casino reckoning (corporate audit, gaming
   commission). Scoring must not depend on the flavor; keep the flavor in one place.
2. **Gambling on your break:** can players gamble their own winnings? Model it in the simulator as a toggle and
   report what it does, so Josh can decide with numbers.

Write any new question for Josh into this list, and tell him in chat at the end of the session.

---

## Principles

- **Borrow solved parts.** Start from Among Us's skeleton (tasks, a meeting, a vote) and its default timings; change
  one thing at a time and write down why. Look up current Among Us default settings (WebSearch) before setting
  timing dials, and cite them in `RULES.md`.
- **The fun checklist (MDA, simplified).** Every minute of play gives every player: a goal they care about, a choice
  with a real cost, a reason to watch other players, uncertainty, and a sense of progress. Run every rule change
  past it.
- **The simulator finds what is broken; only people find what is fun.** The card game passed a 3,000-game balance
  simulation and was still boring. Phase 2 measures fun proxies, but Phase 3 is the real test.
- **One rules engine.** The simulator and the prototype run the same rules code, so simulated findings transfer.
  Policies (bots) see only what a player could see, through one observation interface used by both.
- **Hidden information stays hidden.** The server sends each player only what they can see (fog of war). A client
  that receives everything can be modified to show everything.

---

## Phase 1: `RULES.md`

**Goal:** one file, `games/reality-check/design/RULES.md`, that fully specifies the game for a future Claude: every
rule, every interaction, every number. Not written for players. Precise over pretty.

### Required sections

1. **Premise and pitch** (copied from above).
2. **Map:** The Babel's rooms and what each holds (casino floor with tables and slots, the cage, the bar, the count
   room, the security office, the vault, the locker room, the parking lot). Doors, sight lines, camera coverage,
   which rooms are dark or crowded. A rough grid size and a sketch (ASCII is fine).
3. **Players and jobs:** player count range (target 4 to 8, bots fill), each job's station, honest task, what the
   job can see or reach that others can't, and how jobs rotate.
4. **Time:** shift length, number of shifts, the count, the meeting (discussion and vote lengths), the end.
5. **Money:** where chips come from and go (stations, tips, NPC gamblers, pay), carried chips vs deposited money
   (carried chips can be stolen, found and counted against you), and a conservation statement (every chip has a
   source and a sink).
6. **Actions:** for every honest action and every cheat: who can do it, where, how long it takes, what it changes,
   what it leaves behind (evidence, missing money, heat), and whether it can be interrupted.
7. **Seeing and evidence:** line of sight rules, cameras, NPC security, heat (rises with cheating, decays over
   time), what a witness learns, photos (what one proves, how long it lasts, whether it can be deleted), missing
   money attribution at the count, and the difference between proof and someone's word.
8. **The meeting:** who speaks when (or free chat), what can be shown, how voting works, what a conviction does
   (fired, fined, chips confiscated, heat), what a wrong conviction does, and what happens to the accuser in each
   case.
9. **Babel events:** the list, what each changes, how often they happen.
10. **End and scoring:** win condition, score formula, tie-breaks, and the flavor hook kept separate (open question 1).
11. **Variants:** gambling on break (open question 2), and any other toggles.
12. **Dial table:** every tunable number: id, name, default, range, what it affects, which metric should move when it
    changes. Expect about 3 dials per cheat (payout, duration, visibility) plus economy and timing dials.
13. **Expected-value check:** for each cheat, the expected value of doing it once and of doing it the k-th time in a
    shift, against the honest pay for the same time:
    `EV(cheat) = payout - P(seen) * P(convicted | seen) * penalty - heat_cost(k)`.
    Work through concrete numbers at default dials. Targets (hypotheses to test in Phase 2): one cheat is tempting
    (roughly 1.3 to 2 times honest pay in expectation, with high variance), and cheating every chance you get is
    worse than cheating selectively (the k-th cheat in a shift has falling EV). Show the table, and flag any cheat
    that is never worth it or always worth it.
14. **Decision log:** every rule choice that wasn't obvious, with the alternatives and why. Phase 2 adds to it.
15. **Known gaps:** anything not yet specified. Phase 1 can't end with gaps that block the engine.

### Tasks

- [ ] 1.1 Look up Among Us default settings and the timing of a typical game (WebSearch). Note sources.
- [ ] 1.2 Draft sections 1 to 11.
- [ ] 1.3 Dial table (section 12).
- [ ] 1.4 Expected-value check (section 13), with a tiny script in the scratchpad if the arithmetic needs it. Copy
      the results into `RULES.md`, not the script.
- [ ] 1.5 Self-review pass: read `RULES.md` as an adversary. For every action, ask "what if two players do this at
      once?", "what if the target is in another room?", "what if this happens during the count or the meeting?",
      "what stops someone doing this forever?". Fix or log each answer.
- [ ] 1.6 Commit and push. Summarize the rules for Josh in chat in under 15 lines, and list new questions for him.

**Exit criteria:** every action and number is specified; no known gap blocks writing the engine; the EV table shows
no cheat that is always or never worth doing at default dials (or the gap is logged as a Phase 2 question).

---

## Phase 2: engine, simulator, red-team, report

**Goal:** stress-test the mechanics realistically before anything is drawn. Find logic bugs, contradictions,
dominant strategies, dead time and boring stretches. Some weak points need creative fixes: see Fix triage.

### Layout

```
games/reality-check/
  design/PLAN.md, design/RULES.md
  shared/engine/      pure rules engine: no DOM, no Node APIs, relative imports only (runs in Node, browser, worker)
    map.js            the casino as boxes on the x/z plane; rooms, doors, stations, cameras
    state.js          world state, seeded random number generator
    actions.js        every action as validate(state, actor, args) and apply(state, ...) -> events
    sight.js          line of sight, cameras, who-saw-what
    shift.js          the shift clock, the count, the meeting, scoring
    observe.js        observation(state, playerId): only what that player can see or knows
  shared/policies/    bot strategies written against observe.js output only (reused by bot.js in Phase 3)
  sim/                Node-only: runner, metrics, red-team scenarios, exploit search, report writer
    run.js            `node games/reality-check/sim/run.js [--games N] [--seed S] [--dials file]`
    REPORT.md         generated: numbers, verdicts, and what changed since the last report
test/reality-check-engine.test.js   unit and invariant tests (part of `npm test`, must stay fast: under 10 s)
```

### Simulation fidelity

- Time steps of a fixed size (for example 0.25 s of game time), faster than real time.
- Agents move on the real map with `NavGrid` paths at a walking speed, so travel time, crowding and sight lines are
  real. NPC gamblers wander between tables, the bar and the cage, carrying chips; NPC security patrols.
- The meeting can't be simulated faithfully (it is people talking). Model it with **beliefs:** each agent keeps a
  suspicion score per player built from evidence it has (saw a cheat, holds a photo, missing money at a station that
  player worked, heat it noticed, accusations by others weighted by that accuser's credibility). Agents accuse,
  lie, frame and vote by policy. Treat meeting results as approximate and check them in Phase 3.
- Every run is reproducible from a seed. Every simulated game can dump a full event log for debugging.

### Policy ladder (bots), each a small parameterized strategy

Honest worker; reckless cheater (cheats at every chance); opportunist (cheats only when it sees no one);
watcher (follows people and photographs); accuser (accuses on thin evidence); liar (false accusations and fake
photos); framer; security abuser (wipes tape, sells silence); colluding pair; cartel (everyone agrees not to
accuse); hoarder (never deposits); random. Plus a **mixed field** drawn from these, and an **adaptive** policy
whose parameters (cheat threshold, risk tolerance, accuse threshold, lie rate) are searched (see Red-team).

### Invariants (assert in tests and in every simulated game)

- Chips are conserved: total chips in the world change only through defined sources and sinks.
- Nobody witnesses anything outside their line of sight; nobody acts in two places; no action outside its job,
  room or phase; no action during the meeting except meeting actions.
- Every piece of evidence points to a real event; deleting evidence removes it everywhere it was stored.
- No negative money, no NaN, no player stuck forever, every shift and every game ends.
- The observation for a player contains nothing that player could not know.

Add a fuzzer: random legal and illegal actions at random times for thousands of steps; the engine must refuse illegal
ones and keep every invariant.

### Red-team catalog (each one is a scenario with a verdict in REPORT.md)

- R1 Everyone cheats and nobody accuses (the cartel). Does the game punish it or stall?
- R2 Never cheat, accuse everyone. Can a pure accuser win?
- R3 Camp the most valuable station all shift. Does sitting still beat moving?
- R4 Follow one player all shift. Is shadowing too strong, or useless?
- R5 Security wipes every tape every shift. Is the security job a free pass?
- R6 False accusations with no evidence. Do lies cost the liar anything?
- R7 Kingmaking: a losing player decides the winner. How often?
- R8 Snowball: does the leader at the halfway point almost always win?
- R9 Hoarding chips without depositing, or depositing constantly. Is one always right?
- R10 Bribe chains and mutual blackmail. Do they lock the game up?
- R11 One player has disconnected or is idle. Does the game still work?
- R12 Small games (4 players) and big games (8). Do the numbers still hold?
- R13 Each Babel event: does any one of them decide the game by itself?
- R14 Any action whose best choice is the same over 90 percent of the time (a fake choice).
- R15 Exploit search: optimize the adaptive policy's parameters against the mixed field (simple random search or
  hill climbing is enough). Any parameter set that wins far above its share, or any extreme value (for example
  "never deposit", "always accuse"), is an exploit to fix or a decision to log.

### Metrics and starting targets

Targets are hypotheses: published data for this genre is scarce (Innersloth has said impostors win more Among Us
games than crewmates, and people love it anyway; chess's first-move edge is about 52 to 56 percent). Adjust targets
with Josh when there is reason to; log every change.

| Id | Metric | Starting target |
|---|---|---|
| M1 | Win rate of each pure policy against the mixed field | No pure policy wins far above its share; at least 2 or 3 styles can win |
| M2 | Start or job-rotation advantage | Close to even |
| M3 | Share of cheats seen by someone | Roughly 30 to 50 percent |
| M4 | Meetings with real evidence to argue about | Most meetings |
| M5 | Wrong convictions | Happen sometimes, not most of the time |
| M6 | Leader at halfway still wins | Well under always |
| M7 | Dead time: seconds per minute with no decision to make | A few at most |
| M8 | Decisions per minute per player | Several |
| M9 | Close finishes (winner's margin small) | Common |
| M10 | Shift and game length | Shift a few minutes, game 15 to 25 minutes |
| M11 | Choice quality: share of decisions where the best option depends on context | High (see R14) |
| M12 | Drama per shift: catches, frames, betrayals, collusions | At least one most shifts |

### Fix triage (when the simulator finds a weak point)

- **Bugs and contradictions:** fix in the engine, add a test that would have caught it.
- **Number problems:** change dials, rerun, record before and after in REPORT.md.
- **Small rule fixes** that don't change the pitch or the feel: decide, implement, log in `RULES.md`'s Decision log.
- **Creative decisions** (changes that alter what the game feels like, add a system, remove a cheat, or change the
  pitch): write up two or three options with simulated numbers for each, and ask Josh in plain text. Keep going on
  other work meanwhile.

### Tasks

- [ ] 2.1 Map model and line of sight, with tests.
- [ ] 2.2 State, actions (first slice: work, deposit, skim, pickpocket, photograph), the shift clock and the count.
- [ ] 2.3 Meeting model (beliefs, accusations, votes) and scoring.
- [ ] 2.4 Observation interface and the first policies (honest, reckless, opportunist, watcher, random).
- [ ] 2.5 Invariants and fuzzer in `test/reality-check-engine.test.js`.
- [ ] 2.6 Runner, metrics M1 to M12, and the first `REPORT.md`.
- [ ] 2.7 Red-team scenarios R1 to R14 and the exploit search R15; fix triage loop until the slice is sound.
- [ ] 2.8 Add the remaining cheats (bribe, steal credit, frame, cover up, collusion) one at a time, each with its
      policies, tests and a report rerun.
- [ ] 2.9 Run the gambling toggle and both ending flavors through the report for Josh's open questions.
- [ ] 2.10 Commit, push, and summarize REPORT.md for Josh: what broke, what was fixed, what needs his call.

**Exit criteria:** invariants hold over at least 10,000 fuzzed steps and 1,000 simulated games; every red-team
scenario has a verdict (fixed, accepted with a reason, or waiting on Josh); metrics are within targets or each miss
is explained; the first-slice game (skim, pickpocket, photo, count, meeting) is sound on its own.

---

## Phase 3: greybox prototype on friendslop

**Goal:** the smallest version friends can play over a voice call, to find out whether catching someone is fun.
Greybox means rectangles and dots: no art, no polish.

### Scope

The first slice only: 4 to 8 players plus bots, one casino map, jobs, work, deposit, skim, pickpocket, photograph,
the count and the meeting. Two or three shifts per game. Later cheats come back one per playtest, Bribe first.

### Build

- `server.js` wraps `shared/engine` with `defineGame` (tick rate around 10 to 15 Hz; spatial games need it).
- Movement: client sends input; server moves (start simple, add client prediction only if it feels laggy).
- Fog of war on the server: each player gets a per-player snapshot built from `observe.js`.
- `client/index.js`: top-down 2D canvas in the Blockout look (see `games/cp` and the starter template for style),
  walls, rooms, stations, dots for people, a sight-cone or visibility mask, action prompts, a photo button, the
  count screen, and the meeting screen (accusations, photo gallery, vote). Phones: check it at 390 px wide.
- `bot.js`: runs the Phase 2 policies through the same observation interface.
- **Logging:** every event (actions, sightings, photos, accusations, votes, results) as structured lines. Verify the
  transport before relying on it: for playtests, host on Josh's machine with `npm run tunnel` and `GAMES_DIR`
  set to `games/`, so `server.js` runs in Node and `ctx.log.info` lines can be captured to a file. For link-hosted
  games, show a summary at the end with the log in a selectable text box (the sandboxed frame likely blocks
  downloads and the clipboard; test it).
- A small script that turns a playtest log into the same metrics as the simulator (M1 to M12 where they apply).
- Tests: the fake-ctx harness from the card version, adapted; plus one real-server test with bots, like
  `test/starter.test.js`.

### Playtest protocol (Josh runs it; Claude prepares everything)

1. 3 to 7 friends on a voice call, about 20 minutes, one or two games.
2. Before: a 30-second explanation using only the pitch and the controls. If it takes longer, note what needed
   explaining.
3. After, ask each player: When were you most tense? What did you want to do that you couldn't? Would you play again
   right now? (The last answer matters most.)
4. Collect the log. Run the metrics. Compare with the simulator and write the differences into REPORT.md.
5. Change one dial or one rule per session. Keep a playtest log in this file.

### Tasks

- [ ] 3.1 Map rendering, movement, jobs and work (one player can walk around and earn).
- [ ] 3.2 Fog of war and per-player snapshots.
- [ ] 3.3 Skim, pickpocket, photograph, heat, with on-screen feedback.
- [ ] 3.4 The count and the meeting screens.
- [ ] 3.5 Bots from Phase 2 policies.
- [ ] 3.6 Logging and the log-to-metrics script; verify the transport.
- [ ] 3.7 Browser test pass (Playwright, desktop and phone width, two humans plus bots, link-hosted via `DEV_CDN=1`).
- [ ] 3.8 Commit, push, and give Josh a playtest kit: how to host, the 30-second pitch, the three questions.
- [ ] 3.9 Playtests with Josh's friends (Josh runs them); iterate one change at a time.

**Exit criteria (the fun gate):** in at least two playtests, most players say yes to "would you play again right
now", and the log shows real catches and real arguments in the meetings. If the gate fails twice, stop and rethink
with Josh before adding anything.

---

## Phase 4: art (only after the fun gate)

- Characters from the LPC generator in `joshhickson/reality_check` (`lpc-generator/`): pick a small set of bodies,
  outfits per job (dealer vest, security uniform, bartender, cashier, valet), and walk cycles. Credit every asset
  (CC-BY-SA, GPL); keep a `CREDITS` file in the game's `assets/`.
- A casino tileset (find openly licensed top-down tiles; record licenses).
- Keep the greybox renderer working behind a toggle so playtests can compare.
- Files under 20 MB each and the commit under 150 MB (jsDelivr limits for link hosting).

---

## Session log

Newest last. One line per session or milestone: date, what was done, where it stopped.

- 2026-10-28: Plan written. Branch `reality-check-casino` created from `main` (e5f6c94). Next: Phase 1, task 1.1.
