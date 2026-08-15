# Tapper — Design

## Concept

Tapper is a one-against-the-clock service game. You are the barkeep at *The
Thirsty Canvas*, working **four bars at once**. Customers push in through the
door at the far end of each bar and walk steadily toward your taps. The only
thing that stops them is a full mug slid down the counter: catching one shoves a
customer back down the bar, and after a drink they send the **empty** sliding
back at you. You must be standing at that bar to catch it.

Everything on the counter is a hazard if you ignore it. A customer who reaches
the taps grabs you; a mug poured at an empty bar runs off the far end and
smashes; an empty you fail to catch shatters at your feet. All three cost a
life, and you only have three.

The tension is that the four bars share one barkeep and one pair of hands. Every
mug you pour creates an empty you will have to be somewhere else to catch, so
the game is really about *scheduling*: pouring early enough to stop a customer,
but not so early that three empties come back at once.

## Mechanics

- **The bars.** Four counters (`LANES` = 4) at `laneY(0..3)`. Each runs from
  `BAR_LEFT` (60, the door) to `BAR_RIGHT` (590, the taps). The barkeep stands
  behind the tap end and can only be on one bar at a time.
- **Customers** enter at the door and walk right at `customerSpeed(level)` px/s.
  A customer whose leading edge reaches `TAP_X` grabs the barkeep — a life.
- **Pouring.** `Space` pours a full mug on the barkeep's current bar. Mugs slide
  left at `MUG_SPEED`. The tap needs `POUR_COOLDOWN` (0.25 s) between pours.
- **Serving.** A mug that overlaps a customer is caught by the *rightmost*
  customer it touches (the one nearest the taps, i.e. the most urgent threat).
  The mug disappears, `HIT_POINTS` are scored, and that customer slides back at
  `PUSH_SPEED` for `PUSH_TIME` — roughly 130 px per mug.
- **Thirst.** Every mug a customer catches raises their walking speed by
  `DRINK_SPEEDUP` (×1.16), capped at `SPEEDUP_MAX` (×1.9) of their starting
  speed, and their coat reddens. Without this you could volley a single customer
  back and forth forever for free points; with it, a customer you keep feeding
  becomes the one that eventually beats you to the taps.
- **Being served.** A customer pushed clean off the far end (`x <= BAR_LEFT -
  CUSTOMER_W`) is served for `SERVE_POINTS` and counts toward `served`.
- **Empties.** After sliding back, a customer drinks for `DRINK_TIME` and then
  sends an empty mug back toward the taps at `EMPTY_SPEED`. If the barkeep is on
  that bar when the empty passes `CATCH_X`, it is caught for `CATCH_POINTS`;
  otherwise it reaches `BAR_RIGHT` and smashes — a life.
- **Spills.** A full mug that reaches the far end with nobody to take it falls
  off and smashes — a life. Pouring speculatively is punished.
- **Waves.** Wave `n` needs `WAVE_BASE + 2n` customers served. They arrive every
  `spawnInterval(level)` seconds, up to `maxOnScreen(level)` on the counters at
  once. Clearing a wave scores `WAVE_BONUS × level` and, after a short
  `WAVE_DELAY` break, starts the next level: faster customers, arriving sooner,
  more of them.
- **Losing a life** clears the counters completely, credits any customers who
  were on them back to `toSpawn` (so a wave always needs the same number served
  no matter how badly it goes), and pauses for `RESPAWN_DELAY` with a banner
  saying what went wrong. At zero lives the game ends and the score is compared
  against the best in `localStorage` under `tapper-best`.

### Key constants

| Constant | Value | Meaning |
|---|---|---|
| `LANES` | 4 | number of bars |
| `BAR_LEFT` / `BAR_RIGHT` | 60 / 590 | door end and tap end of a bar |
| `CATCH_X` | `BAR_RIGHT - 46` | empties become catchable here |
| `MUG_SPEED` / `EMPTY_SPEED` | 300 / 220 | full mug out, empty mug back (px/s) |
| `POUR_COOLDOWN` | 0.25 | seconds between pours |
| `CUSTOMER_SPEED` / `_STEP` / `_MAX` | 26 / 7 / 78 | walk speed at level 1, per level, cap |
| `DRINK_SPEEDUP` / `SPEEDUP_MAX` | 1.16 / 1.9 | thirst speed-up per drink, and its ceiling |
| `PUSH_SPEED` / `PUSH_TIME` | 260 / 0.5 | how far a served customer is shoved back |
| `DRINK_TIME` | 1.1 | pause before the empty comes back |
| `HIT_POINTS` / `SERVE_POINTS` / `CATCH_POINTS` | 50 / 150 / 100 | mug taken, customer served, empty caught |
| `WAVE_BASE` / `WAVE_BONUS` | 4 / 300 | wave size base (`+2×level`), bonus per level |
| `START_LIVES` | 3 | lives |

## Controls

| Key | Action |
|---|---|
| ↑ / W | Move up one bar |
| ↓ / S | Move down one bar |
| Space | Start the shift — and pour a mug while playing |
| P | Pause / resume |

The Start button does the same as Space from the idle, game-over and paused
states.

## Code structure

`game.js` is a single script with module-level globals and no build step, in the
same shape as the other games in this repo:

- **State** — `state` (`idle` / `playing` / `wave` / `respawn` / `paused` /
  `gameover`), plus `customers`, `mugs`, `empties`, `player.lane` and the score
  counters.
- **`step(dt)`** — the whole simulation, advanced by a fixed `dt`. It runs
  `updateSpawns` → `updateCustomers` → `updateMugs` → `updateEmpties` →
  `checkWave`. Each of those bails out early if `state` stopped being `playing`,
  which is how a life lost mid-frame stops the rest of that frame cleanly.
- **`draw()`** — pure rendering; it never mutates game state, so the specs can
  call it at any point to prove a scene renders. Animation that would normally
  use wall-clock time (the customers' walk bob) is derived from position
  instead, so drawing stays deterministic too.
- **`frame(now)`** — the only caller of `step` with real time, clamped to 50 ms
  so a backgrounded tab cannot teleport a customer into the taps.
- **`spawnCustomer(lane, x)` / `spawnEmpty(lane, x)` / `pourMug()`** return the
  object they create, which is both convenient in the game code and the specs'
  way of seeding an exact scenario.

## Testing

Built test-first with Playwright: `tests/tapper.spec.js` was written and run red
before `game.js` existed, then filled in until all 62 specs passed. The specs
drive `step(dt)` directly rather than waiting on the animation loop, so they are
deterministic; customer arrivals are switched off with `spawnEnabled = false`
for any spec that is not about arrivals.

Two design problems were found by a scripted bot that played 180 simulated
seconds of the game rather than by reading the code:

1. **Points could be farmed forever.** A bot that only ever hit customers in the
   middle of the bar scored 11 200 points without serving a single customer or
   losing a life. That is what `DRINK_SPEEDUP` fixes: refusing to finish a
   customer off now costs you speed later.
2. **Every loss was a spilled mug.** The first bot poured at any customer on its
   bar, including ones about to be pushed off the end, and died three times to
   mugs sliding off into space. That is a genuine skill requirement rather than
   a bug, but it is why the respawn banner names the cause (`MUG SPILLED!`,
   `MUG SMASHED!`, `GRABBED!`) — losing a life should teach you something.

## Assumptions

- **Branch name.** The task asked for a branch named after the game
  (`tapper`), but this session is required to develop and push on its
  designated branch `claude/loving-euler-6si1zm`. The designated branch wins;
  no `tapper` branch was created.
- **Pouring is one keypress.** The arcade original has you hold the tap handle to
  fill a mug and release to slide it. That is modelled here as a single `Space`
  press with a short cooldown — the simpler interpretation, and it keeps the
  input the same shape as every other game in the repo.
- **One barkeep sprite, no walking.** The barkeep changes bar instantly instead
  of running along the station. Lane-to-lane travel time would add a second
  resource to manage and a lot of tuning; instant movement keeps the difficulty
  in the scheduling problem.
- **No bonus round, no thrown-mug catch.** The original's coin-bonus screen and
  the customers who throw a mug *at* you were left out. The four-bar juggling
  act is the game; the extras are separate mini-games.
- **Customers are anonymous.** No cowboy/athlete/punk crowd types with different
  speeds — one customer type whose speed comes from the level and from how much
  they have already drunk.
- **A spilled mug costs a life**, as in the original, rather than merely losing
  points. It is the rule that makes pouring a decision instead of a reflex.
- **Wave sizing** (`4 + 2×level`) and the speed curve were picked by playtesting
  with the bot described above: a competent player clears the first four levels
  without losing a life, and pressure builds from there.
