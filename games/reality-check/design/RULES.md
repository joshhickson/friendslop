# Reality Check (casino): rules

For Claude, not for players. This is the specification the engine (Phase 2) and the prototype (Phase 3) implement.
Every number here is a dial (see section 12); the defaults are starting guesses that Phase 2 tests. When a rule
changes, change it here first and add a line to the Decision log (section 14).

Units: money in dollars ($, the casino's chips), distance in meters (m), time in seconds (s). The map is a 2D plane:
x grows east, y grows south. (The friendslop kit works on x/z; the engine maps this y to z.)

---

## 1. Premise and pitch

> "You all work the night shift at a casino. Everyone's skimming. The cameras see everything, except when they
> don't."

The casino is **The Babel**. Every player is an employee with a job. Nobody is assigned a secret role: everyone can
cheat, nobody has to, and the game is about deciding when it's safe. Honest work pays slowly. Cheating pays fast, but
anyone who sees it can tell the others, a photo proves it, and the morning count shows what's missing. After each
shift the staff meet, argue and vote on one person to turn in. Most money banked after the last shift wins.

Design intent, in order: catching someone (or nearly being caught) is the fun; every minute has a choice with a real
cost; other players matter more than the house; nothing that persists is just a number nobody looks at.

## 2. Map

A 62 x 32 m map: the casino building (x 0 to 48) and an outdoor parking lot (x 48 to 62). Walls block movement
and sight. Doors are gaps in walls. Rectangles below are `x0..x1, y0..y1`.

```
x: 0     6     10                24  26                 40      48           62
y0 +-----+-----+--------------------------------------+-------+
   | SEC D     STAFF CORRIDOR (y 0..6)       D(corr)  D  CAGE  |
   |     |                                   |        |  [drw] |
y6 +-----+-----+-----------------+==+--------+--------+--WWWW--+
   |           |                 staff door           window   |
   |   BAR     |   [Table A]     [Table B]     [Table C]       |
   |  (dark)   arch                                            |
   |  [reg]    arch                                            |
   |           |                                               +-------------+
y20+-----------+     [slots]  [slots]  [slots]  [slots]        D  PARKING    |
   |  LOCKERS  D                                               D  (valet)    |
   |           |     [slots]  [slots]  [slots]  [slots]        |   cars      |
y32+-----------+------------------D==D-------------------------+-------------+
                              front entrance
```

| Room | Rectangle | Light (vision x) | Contents |
|---|---|---|---|
| Casino floor | 10..48, 6..32 | 1.0 | Tables A (16..20, 12..14), B (26..30, 12..14), C (36..40, 12..14); slot banks (4 m x 1 m, block sight) at y 21..22 and y 26..27, x 14..18, 22..26, 30..34, 38..42 |
| Bar | 0..10, 6..20 | 0.6 (dark) | Counter 2..8 at y 9; register at (5, 9); bartender side is y 6..9 |
| Locker room | 0..10, 20..32 | 0.8 | One locker per player along x = 0.5; no camera (by law, the casino jokes) |
| Staff corridor | 6..40, 0..6 | 1.0 | Connects the security office, the floor (staff door) and the cage |
| Security office | 0..6, 0..6 | 1.0 | Monitor desk at (3, 3) |
| Cage | 40..48, 0..6 | 1.0 | Drawer at (44, 2); window to the floor at y = 6, x 42..46 (sight passes, movement doesn't) |
| Parking lot | 48..62, 16..32 | 0.7 | Valet stand at (50, 24); 8 parked cars (2 x 4 m, block sight) |

Doors (width 2 m unless noted): security office to corridor (x 6, y 2..4); corridor to floor, the staff door
(x 24..26, y 6); corridor to cage (x 40, y 2..4); bar to floor, an open arch (x 10, y 10..16, 6 m wide); lockers to
floor (x 10, y 24..26); floor to parking, the valet door (x 48, y 22..26, 4 m wide); front entrance (x 26..30, y 32,
NPCs only).

**Cameras** (fixed; each sees a cone, blocked by walls and tall objects like slot banks):

| Id | Position | Facing | Cone | Range | Covers |
|---|---|---|---|---|---|
| C1 | (18, 6.5) | south | 100 deg | 12 m | Tables A and B |
| C2 | (38, 6.5) | south | 90 deg | 12 m | Table C and the cage window |
| C3 | (46, 5.5) | north-west | 90 deg | 6 m | The cage drawer (the whole cage) |
| C4 | (5, 6.5) | south | 40 deg | 5 m | The bar register only |
| C5 | (39, 3) | west | 60 deg | 14 m | The corridor's east half and the cage door |
| C6 | (49, 20) | south-east | 80 deg | 10 m | The valet stand and the first row of cars |

Blind spots by design: the slot rows' south side, the bar seating, the locker room, the security office, the
corridor's west end, the far rows of the parking lot.

## 3. Players and jobs

- 4 to 8 participants (humans plus friendslop lobby bots). Below 4 the meeting doesn't work; the host can't start.
- Each shift every player gets one job. Jobs rotate: nobody holds the same job two shifts in a row if it can be
  avoided, and security goes to a different player each shift until everyone has had it.

| Players | Jobs |
|---|---|
| 4 | Dealer A, Bartender, Cashier, Security |
| 5 | + Valet |
| 6 | + Dealer B |
| 7 | + Dealer C |
| 8 | + Floor runner |

A table with no dealer is closed (no gamblers sit there, no float to skim).

| Job | Post (where "on post" is measured) | Honest work | Station money | Notes |
|---|---|---|---|---|
| Dealer | Within 2 m of the dealer spot (north side of the table) | **Deal** (hold 4 s, needs a seated gambler): tip $5 to $15 | Table tray, float $2,000 | Most visible job: always on camera (C1, C2). Table A is the high-stakes table: tips x1.5, and each deal adds +3 heat |
| Bartender | Behind the counter (y 6..9) | **Serve** (hold 3 s, needs a gambler at the counter): tip $3 to $10, the gambler gets +1 drunk | Register, float $800 | Dark room, crowded |
| Cashier | Inside the cage | **Exchange** (hold 3 s, needs a gambler at the window): tip $0 to $5 | Drawer, float $5,000 | Always on camera (C3), so skimming here needs a plan |
| Security | Inside the security office | **Watch** (stay at the desk): sees every camera feed live | None | Can photograph a monitor (proof). The watcher job |
| Valet | Within 3 m of the valet stand | **Park** (hold 4 s when a car waits): tip $5 to $20 | None; can **Rummage** parked cars (a pickpocket variant) | Outside, dim |
| Floor runner | Anywhere on the floor | **Refill** a slot bank (hold 3 s): wage only | Slot hoppers, float $3,000 total | Moves around: sees a lot |

**Wage:** $1.50 per second while on post, for every job. Off-post seconds are recorded per player and shown at the
count (section 8). Security is on post only while at the desk.

## 4. Time

| Phase | Default length | What happens |
|---|---|---|
| Briefing | 8 s | Jobs announced; Babel event of the shift announced |
| Shift | 240 s | Free movement and actions |
| Count | 15 s | Movement frozen; the count report is shown |
| Discussion | 45 s | Chat (and voice, outside the game); photos can be presented |
| Vote | 45 s | Everyone votes for one player or Skip |
| Reveal | 6 s | The result: who was turned in, guilty or innocent |

Default 3 shifts. A game is about 3 x (8 + 240 + 15 + 45 + 45 + 6) = 1,077 s, about 18 minutes, plus a final
reveal of about 20 s. Target from PLAN.md: 15 to 25 minutes.

**Benchmark (Among Us).** The protocol's default meeting is 15 s of discussion and 120 s of voting; community guides
call the defaults slow and suggest 30 to 45 s of discussion; games typically run 10 to 15 minutes. Our meeting (15 +
45 + 45 + 6 = 111 s) sits close to that total but spends more of it talking, because our count report gives more to
talk about. Sources: [among-us-protocol GameOptionsData](https://github.com/roobscoob/among-us-protocol/blob/master/07_miscellaneous/01_the_structure_of_the_gameoptionsdata_object.md),
[PCGamesN settings guide](https://www.pcgamesn.com/among-us/settings-best),
[CyberPost on game length](https://cyberpost.co/how-long-can-an-among-us-game-last/) (weak source).

## 5. Money

Every dollar lives in exactly one account at any moment:

- **House:** the casino. Pays wages, holds the station floats' reserve, receives fines, funds NPC pockets.
- **Station floats:** table trays, the register, the drawer, the slot hoppers. Reset to their float at shift start
  (the reset is a house transfer, logged).
- **NPC pockets:** each gambler's chips. Tips move from a pocket to a player. A gambler spawns with $100 to $600
  (uniform), funded by the house; when a gambler leaves, the remainder returns to the house.
- **Player carried:** chips on a player. Tips, skims and pickpockets land here. Can be pickpocketed. Confiscated on
  a guilty conviction.
- **Player locker:** chips deposited at the player's own locker. Safe from pickpockets.
- **Player bank:** the score. At the end of each shift, carried and locker chips move to the bank (everyone cashes
  out on the way home). Wages are paid to the bank at the end of the shift. The bank can go negative (debt, from
  restitution).

**Conservation:** the sum over all accounts is constant except for explicit, logged house transfers (float resets,
gambler spawns and departures). The engine asserts this every step.

## 6. Actions

Every action has: who, where, a hold time (the player holds the button; releasing or moving cancels it), a cooldown,
its effects, and what it leaves behind. Actions only happen during a shift. Movement speed is 3.5 m/s for players
and 2 m/s for NPCs. A player does one action at a time. "Visible" means the action has an animation anyone with
sight of the player can see (section 7).

### Honest actions

| Action | Who, where | Hold | Effect | Leaves |
|---|---|---|---|---|
| Deal / Serve / Exchange / Park / Refill | The job's worker, on post, with an NPC to serve (Refill: a bank below half) | 3 to 4 s (section 3) | Tip to carried; dealing at Table A (high stakes) adds +3 heat | Visible, innocent |
| Deposit | Any player, at their own locker | 1 s | All carried chips move to the locker | Off-post time |
| Photograph | Any player, anywhere; security also from the monitor desk (any camera's view) | 0.5 s to raise the phone, then the snapshot | Captures what is visible at that instant (section 7) | Visible (a phone icon) |
| Watch | Security at the desk | none (passive) | Sees all camera cones live, as if standing there | none |

Photos: 3 per player per shift. A photo expires at the end of that shift's meeting.

### Cheats (first slice: Skim and Pickpocket; the rest are specified for later slices)

**Skim** (first slice)
- Who: anyone at a station's tray spot (the dealer spot, behind the bar register, the cage drawer, a slot hopper).
  The worker on post skims normally. Anyone else can skim a station only while its worker is more than 4 m away,
  and takes 1.5 times as long.
- Hold: up to 5 s; chips flow at $50 per second while held, capped by what's left in the float.
- Cooldown: 10 s.
- Effect: chips to carried; the float drops; heat +10 per second held.
- Leaves: a visible animation (hand into the tray); a camera record if a camera sees it; the station's shortage at
  the count.

**Pickpocket** (first slice)
- Who: anyone, against a gambler or another player within 1.2 m. The target must stay within 1.5 m for the whole
  hold, or it cancels.
- Hold: 2 s. Cooldown: 8 s. Each target can be pickpocketed once per shift by the same player.
- Effect: from a gambler, 30% of their pocket (max $250); from a player, 50% of their carried chips (max $250).
  Heat +25.
- A cancelled attempt ("fumble"): nothing taken, heat +10, and the target notices at half the usual chance.
- Victims: a gambler notices with probability 0.5 minus 0.1 per drink (minimum 0.15) and reports it at the count
  with the room it happened in and a time window of 30 s. A player always notices, after a random 5 to 20 s delay
  ("your pocket feels lighter": the amount, not who), and gets +20 heat (victims sweat too).
- Leaves: a visible animation; camera records; victim reports.

**Rummage** (first slice, valet only, a pickpocket variant): open a parked car, hold 3 s, take $50 to $150 from the
glovebox. The car's owner reports it at the count with probability 0.5. Heat +20.

**Bribe** (slice 2): offer a sum to another player in private; if they accept, the money moves and both get a
**Pact** marker visible only to the two of them. A pact holder who presents evidence against the other forfeits the
bribe back and both get +40 heat. Purpose: makes witnesses into accomplices.

**Steal credit** (slice 2): stand at a coworker's station while they're off post and use their honest action; the
tip goes to you. Not a cheat for conviction purposes, but it shows as "worked someone else's station" in the count.

**Frame** (slice 2): drop up to $200 of your carried chips into another player's locker (hold 2 s, locker room). At
the count, chips in a locker that the owner didn't deposit are flagged as "unexplained" (the amount, not the
source). Or fake a photo: costs one photo, produces a photo claiming a chosen player cheated; the reveal after a
conviction exposes it as fake, and the faker gets a guilty mark for fraud.

**Cover up** (slice 2): at the security office desk, hold 4 s to wipe one camera's tape for this shift. The count
reports "tape for camera X was erased" (not who). Or snatch a phone: pickpocket a player and delete their photos
instead of taking chips.

**Collusion** (slice 2, casino special): a dealer and another player seated at their table as a gambler (players
can sit at tables on break); the dealer holds **Deal friendly** for 4 s: the table's float drops $300 and the seated
player's carried rises $300; split in private however they like. Two people, one shortage.

## 7. Seeing and evidence

**Player vision:** 360 degrees, radius 9 m times the room's light factor, blocked by walls, slot banks and parked
cars. Players see other players, gamblers, guards, the visible action animations, sweat and phones
inside their vision.

**Noticing a cheat:** when a cheat animation is in someone's vision, they notice it with probability
`0.95 x light x 1 / (1 + 0.15 x gamblers within 3 m of the cheater)`, checked once per cheat per viewer. A noticed
cheat is written to the viewer's **notebook** (private, automatic): who, what, where, when. An unnoticed cheat
leaves no notebook entry.

**Photos:** a snapshot records every person and animation inside the photographer's vision at that instant
(regardless of noticing). A photo that contains a cheat in progress is **proof**: it names the actor, the action,
the place and the time. Security's monitor photos record a camera's cone instead.

**Cameras:** every cheat inside a camera's cone is recorded on that camera's tape. At the count, each recorded cheat
is flagged with probability 0.2 (the night manager skims the footage too). A flag shows the camera, the station or
area, and a 30 s time window, not the person. Security watching live sees camera cones as vision (and notices with
the same rule).

**Guards:** 1 NPC guard (2 with 7 or more players) walks a fixed loop around the floor. Vision: a 120 degree cone,
7 m. A guard notices cheats like a player does and files a **guard report** naming the actor (strong evidence). A
guard who sees a player with heavy sweat follows them at 3 m for 15 s.

**Heat (sweat):** each player has heat from 0 to 100, decaying 1.5 per second. Anyone who can see a player sees
their sweat level: none (under 20), light (20 to 49), heavy (50 and up). Heat comes from cheats, from being robbed,
and from dealing high-stakes tables, so sweat is a hint and never proof.

**Missing money (shortage):** at the count each station's float is compared with its expected value. Honest error
is added: a normal random amount with standard deviation $100 per station (cage $150, register $60), so small skims
can hide in the noise and big ones can't.

**Off-post time:** each player's seconds off post this shift, shown at the count.

**Evidence strength** (what the simulator's meeting model and the bots use; humans decide for themselves):
proof photo and guard report are strong; a camera flag points at whoever worked or stood near that place in that
window; a shortage points at the station's worker and anyone seen near it; a notebook entry is one player's word;
sweat and off-post time are hints.

## 8. The count, the meeting and the vote

**The count report** (shown to everyone, 15 s):
1. Each station: its worker and its shortage (negative or positive). Skims by anyone other than the worker are not
   shown separately: only the station's total.
2. Each player's off-post seconds.
3. Camera flags (camera, area, time window).
4. Victim reports from gamblers and car owners (amount, room, time window), and player victims' losses.
5. Guard reports (names).
6. Tape erasures and unexplained locker chips (slice 2).

**Discussion (45 s):** free chat. Any player can **Present** a photo; everyone sees it. A notebook entry can't be
presented; players state it in chat (it may be true or a lie).

**Vote (45 s):** each player votes for one other player or Skip; votes are secret until the reveal; a player who
doesn't vote counts as Skip. A player is **turned in** if they have the most votes, at least 2 votes, more votes than
Skip, and no tie for most. At most one player is turned in per meeting.

**Reveal:** the casino reviews everything about the person turned in and announces **guilty** (they cheated this
shift) or **innocent**. Only this shift's cheats count.

- **Guilty:** restitution of every dollar they stole this shift (taken from carried, then locker, then bank, which
  can go negative), all carried chips confiscated, a fine of $250, and they start the next shift with 40 heat (on
  probation). **Bounty:** 50% of the restitution is paid to the players who presented a proof photo of them this
  meeting, split equally; if nobody did, to the players who voted for them, split equally. The rest returns to the
  house.
- **Innocent:** nothing is taken. The house pays them $100 for the trouble. Each player who voted for them pays a
  $50 fine to the house.

Nobody is eliminated. Everyone plays every shift.

## 9. Babel events

None in shift 1. From shift 2 on, one event per shift, drawn without repeats, announced at the briefing.

| Event | Effect for that shift |
|---|---|
| Payday | Gamblers spawn with twice the money; floats are 1.5 times bigger |
| Blackout | From 90 s to 150 s into the shift: cameras off, vision radius x 0.6 everywhere |
| The whale | One extra gambler with $5,000 who tips 3 times as much and goes everywhere |
| Gaming commission | An inspector NPC walks the floor; anything they notice is a guard report |
| Happy hour | Twice as many gamblers in the bar; bar light x 0.8; bar tips doubled |
| New cameras | Two extra cameras covering the bar seating and the slot rows' south side |
| Tip pool | All tips this shift are pooled and split equally at the end (honest work pays everyone) |

## 10. End and scoring

After the last meeting comes the **final reveal**: for each player, their bank, how much they stole in total, how
many times they were turned in (guilty and innocent), and the biggest single cheat of the game. This is the
"reality check" moment and must be fun to read.

**Score = bank.** Highest wins. Ties: fewer guilty convictions, then less stolen, then shared.

**Flavor (open question 1, keep in one function):** a verdict label per player from (stolen total, times caught).
Two flavor sets ready: Heaven / Purgatory / Hell, or a casino reckoning (Employee of the Month / Under
Investigation / Banned for Life). Scoring never depends on it.

## 11. Variants

- **Gambling on break** (open question 2; default off): any player may play a slot machine off post: bet $20 per
  pull, 3 s hold, returns 92% on average (jackpot $1,000 at 1 in 200 pulls; the rest of the payout table is in the
  engine). Off-post time counts.
- **Confirm reveals** (default on): turn off to hide guilty or innocent after a vote (harder, more paranoid).
- **Shifts** 2 to 5, **shift length** 120 to 360 s, **players** 4 to 8.

## 12. Dial table

| Id | Name | Default | Range | Affects | Watch metric |
|---|---|---|---|---|---|
| D1 | shiftSec | 240 | 120..360 | Game length, cheats per shift | M10, M7 |
| D2 | shifts | 3 | 2..5 | Game length, comebacks | M10, M6 |
| D3 | countSec / discussSec / voteSec | 15 / 45 / 45 | 10..30 / 20..90 / 20..90 | Meeting pace | M4, M10 |
| D4 | wagePerSec | 1.5 | 0.5..3 | Honest income | M1, M11 |
| D5 | tips (per action, by job) | section 3 | x0.5..x2 | Honest income, job fairness | M1, M2 |
| D6 | moveSpeed | 3.5 | 2.5..5 | Travel cost, chases | M7 |
| D7 | visionRadius / room light | 9 / section 2 | 6..12 | How often cheats are seen | M3 |
| D8 | noticeBase / crowdFactor | 0.95 / 0.15 | 0.6..1 / 0..0.4 | Witness rate | M3 |
| D9 | skimRate / skimMaxSec / skimCooldown | 50 / 5 / 10 | 20..100 / 2..8 / 5..30 | Skim payout | M1, EV |
| D10 | skimHeatPerSec | 10 | 5..20 | Sweat after skims | M3 |
| D11 | pickShare / pickCap / pickHold | 0.3 / 250 / 2 | 0.1..0.5 / 100..500 / 1..3 | Pickpocket payout and risk | M1, EV |
| D12 | pickHeat / fumbleHeat | 25 / 10 | 10..40 / 0..20 | Sweat after pickpockets | M3 |
| D13 | npcNotice / perDrink / min | 0.5 / 0.1 / 0.15 | 0.2..0.8 | Victim reports | M4 |
| D14 | playerVictimDelay | 5..20 | 0..30 | How fast a robbed player can look around | M12 |
| D15 | heatDecay | 1.5 | 0.5..3 | How long sweat lasts | M3, M5 |
| D16 | sweat thresholds | 20 / 50 | | Hint strength | M5 |
| D17 | cameraReview | 0.2 | 0..0.6 | Camera flags at the count | M4 |
| D18 | camera layout | section 2 | | Blind spots | M3, R3 |
| D19 | guards / guardCone / guardRange / followSec | 1 (2 at 7+) / 120 / 7 / 15 | 0..3 | Floor danger | M3, M1 |
| D20 | shortageNoiseSd (table / cage / register / slots) | 100 / 150 / 60 / 120 | 0..300 | Whether small skims hide | M5, EV |
| D21 | floats (table / register / drawer / slots) | 2000 / 800 / 5000 / 3000 | | Skim ceiling | R3 |
| D22 | photosPerShift / raiseSec | 3 / 0.5 | 1..6 / 0..1.5 | Proof supply | M4, M5 |
| D23 | voteMinVotes | 2 | 1..3 | How easy a conviction is | M5 |
| D24 | fine / restitution / confiscateCarried | 250 / 1.0 / yes | 0..600 / 0.5..2 | Penalty for guilty | EV, M1 |
| D25 | probationHeat | 40 | 0..80 | Being marked after a conviction | M6 |
| D26 | bountyShare | 0.5 | 0..1 | Reward for catching | M1 (watchers), R2 |
| D27 | innocentComp / wrongVoteFine | 100 / 50 | 0..300 / 0..150 | Cost of false accusations | M5, R6, R16 |
| D28 | gamblers (count per shift) | 6 + 2 x players | | Crowds, tips, marks | M3, M12 |
| D29 | npcPocket | 100..600 | | Pickpocket payout | EV |
| D30 | babelEvents on / list | on / section 9 | | Variety | R13 |
| D31 | gamblingOnBreak / slot RTP / jackpot | off / 0.92 / 1 in 200 | | Variant | open question 2 |
| D32 | confirmReveal | on | | Feedback after a vote | M5 |

## 13. Expected-value check

**Model.** Analytic, one player, one shift, ignoring space. It assumes careful (opportunist) and reckless cheaters
have these chances per cheat of producing evidence: a player witness 6% / 25% (of which 40% photograph it), a guard
2% / 6% (reckless rising 50% per extra cheat as sweat builds), a camera record by station (table 50%, bar register
80%, cage 100%, valet 30%; pickpockets: floor 50%, bar 15%) flagged 20% of the time. Chance a piece of evidence leads
to a guilty conviction: proof photo 85%, guard report 85%, word only 30%, camera flag 40%, shortage
`clamp((shortage - 200) / 500, 0, 0.95)` averaged over the honest noise. Combined as independent, then multiplied by
0.75 because only one player can be turned in per meeting and other suspects compete. Careful cheaters bank half
their chips in the locker and pay 15 s off post per two cheats; reckless ones bank nothing. Penalty on a guilty
verdict: everything stolen this shift, carried tips, and the $250 fine. Honest shift: $1.50 x 220 s + $120 tips =
$450.

The model is `sim/ev-model.mjs` (`node games/reality-check/sim/ev-model.mjs`); this table is its output at default
dials. Every probability above is a
guess that Phase 2 replaces with measured values from the spatial simulation, then reruns this table.

| Strategy (one shift) | Stolen | P(turned in, guilty) | Expected take-home | vs honest |
|---|---|---|---|---|
| Honest | $0 | 0% | $450 | 1.00x |
| 1 careful skim of $150 | $150 | 12% | $522 | 1.16x |
| 2 careful skims of $150 | $300 | 33% | $528 | 1.17x |
| 3 careful skims of $150 | $450 | 61% | $395 | 0.88x |
| 1 careful skim of $250 | $250 | 21% | $559 | 1.24x |
| 2 careful skims of $250 | $500 | 65% | $398 | 0.88x |
| 2 reckless skims of $250 | $500 | 73% | $319 | 0.71x |
| 1 careful pickpocket (avg $150) | $150 | 9% | $502 | 1.12x |
| 2 careful pickpockets | $300 | 22% | $530 | 1.18x |
| 4 careful pickpockets | $600 | 43% | $483 | 1.07x |
| 3 reckless pickpockets | $450 | 58% | $326 | 0.72x |
| **1 skim + 1 pickpocket, careful** | $300 | 20% | **$572** | **1.27x** |
| 2 skims + 2 pickpockets, careful | $600 | 47% | $509 | 1.13x |
| 3 skims + 3 pickpockets, careful | $900 | 74% | $291 | 0.65x |

**What it says:**
- No cheat is always worth it and none is never worth it. The first one or two careful cheats pay; each extra
  cheat in the same shift pays less and soon costs more (falling marginal value, as required).
- Reckless cheating loses money after the first cheat.
- **Mixing kinds beats repeating one** (1 skim + 1 pickpocket is the best line at 1.27x), because each kind has its
  own brake: shortage for skims, victim reports for pickpockets. Small cheats spread across kinds compound; piling
  on one kind gets you caught. Keep this property when adding slice-2 cheats: each new cheat needs its own brake.
- The peak (about 1.2 to 1.3x) sits at the low end of the PLAN.md target (1.3 to 2x). Not changed yet on purpose:
  the model ignores bounties (which raise honest income), so the real gap may be smaller. Phase 2 measures it
  spatially before anyone tunes it.

**Earlier versions of the model and what they taught (kept so nobody repeats them):**
1. Fine $400, confiscate everything, probation wages halved: cheating was never worth it (best 0.91x). Too harsh.
2. Confiscating only carried chips: banking stolen chips in the locker made greed pay (six $200 skims at 2.03x).
   Fixed by restitution of everything stolen this shift, wherever it is.
3. Shortage evidence capped at 50%: going huge paid again (six $250 skims at 1.47x). Fixed by letting an obvious
   shortage reach 95%.
4. A bug in the model itself: the off-post evidence used a value left over from the previous calculation, so results
   depended on the order of the runs. Fixed; numbers moved by a few percent and every conclusion held.

## 14. Decision log

| # | Decision | Alternatives | Why |
|---|---|---|---|
| 1 | Nobody is eliminated; a guilty player pays and keeps playing | Firing (out of the game), ghost mode | friendslop sessions are short and social; sitting out is dead time |
| 2 | The vote reveals guilty or innocent (Confirm reveals on) | Hidden result | Feedback teaches players; punishes false accusers; Among Us offers the same option |
| 3 | Restitution of all stolen this shift on a guilty verdict | Confiscate carried only | The EV model showed locker banking made greed pay |
| 4 | Shortage evidence can reach 95% | Cap at 50% | The EV model showed huge skims paid |
| 5 | Wrongful conviction: house pays the innocent $100, each yes-voter fines $50 to the house | Yes-voters pay the innocent | Paying the innocent from voters made fake confessions a way to farm money |
| 6 | Bounty goes to proof presenters, else to yes-voters | Only to presenters; no bounty | Gives honest watchers income (R2) without paying bandwagon voters when proof exists |
| 7 | Sweat comes from cheats and from innocent sources (being robbed, high-stakes dealing) | Cheats only | Sweat must stay a hint; a sure tell would make the game trivial |
| 8 | Photos expire at the meeting; only this shift's cheats count | Evidence persists across shifts | Keeps each meeting about fresh events; probation heat carries a little memory |
| 9 | Non-workers can skim a station only when its worker is away, at 1.5x the time | Only workers can skim | Lets a player make a coworker's station look short (framing without a frame action) |
| 10 | One player turned in per meeting at most | Several | Mirrors Among Us; makes many cheaters each safer, which the EV model needs |
| 11 | Players see 360 degrees, guards and cameras see cones | Cones for everyone | Top-down readability; players already struggle to track who's where |

## 15. Self-review (task 1.5) and known gaps

Adversarial questions and their answers (each now part of the rules above or a Phase 2 scenario):

- **Two players skim the same tray at once?** One tray spot per station; the second can't start while it's taken.
- **Two pickpockets on one target at once?** The target is "busy"; the second attempt can't start.
- **The target walks away mid-pickpocket?** Cancelled as a fumble (heat +10, half the notice chance).
- **Someone acts in two places?** One action at a time, and it cancels on movement.
- **Actions during the count or meeting?** Impossible: movement and actions freeze when the shift ends; an action in
  progress cancels with no effect except heat already gained.
- **What stops skimming forever?** Finite floats, a 10 s cooldown, the growing shortage, and sweat. The EV table
  shows the third skim already loses money.
- **What stops pickpocketing forever?** Once per target per shift, victim reports piling up at the count, sweat
  drawing the guard.
- **Security sits in the office all shift and never cheats?** Fine: that's the watcher job, paid wages only. Its
  power is seeing cameras; its weakness (slice 2) is bribes and the tape-wipe being reported.
- **A security player wipes every tape?** Slice 2: every wipe is reported at the count, and the security office is
  where wipes happen, so security becomes the suspect. Phase 2 scenario R5.
- **A player tries to get wrongly convicted for the $100?** Possible ("fake confession"). Capped at $100 per meeting
  and the voters lose $50 each, so groups learn. Phase 2 scenario R16 checks it isn't a winning line.
- **A partner photographs you on purpose to farm the bounty?** The group loses money: you repay everything plus the
  fine and your partner gets half the restitution. Not profitable.
- **Everyone cheats and nobody votes (the cartel)?** Shortages and guard reports still appear; one guard and the
  cameras keep some pressure, and any player can defect for the bounty. Phase 2 scenario R1.
- **Voting yourself?** Not allowed.
- **A player disconnects mid-shift?** Their character walks to the locker room and stands there; no wages; their
  station can be skimmed by others; they still appear in the count. They keep their bank and can come back.
  Bots can take over only if friendslop's lobby adds one (not automatic).
- **A player joins mid-game?** They spectate until the next briefing, then get a job and a bank of $0. (Phase 3 may
  give late joiners the lowest bank so far, to keep them in it; logged as a gap.)
- **Bank goes negative?** Allowed (debt). The final reveal shows it.
- **Chips appear or vanish?** Conservation (section 5) is asserted by the engine.

Known gaps (none blocks the first-slice engine):
- G1: The exact gambler behavior (how long they sit, where they go, how often they visit the cage). Phase 2 picks
  simple rules and documents them here.
- G2: The guard's patrol path (waypoints). Phase 2 draws it on the map.
- G3: The slot machine payout table for the gambling variant (only the RTP and jackpot are fixed).
- G4: How bots argue in chat during the meeting (Phase 3; the simulator models beliefs only).
- G5: Late joiners' starting bank.
- G6: Slice-2 cheats need their own brakes checked in the EV model before they're built (see section 13).
