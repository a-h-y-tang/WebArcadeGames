# Soda Tapper — Design

## Concept

A single-screen arcade game in the mould of *Tapper*. You are the soda jerk
behind four parallel counters. Thirsty customers push in from the far (left) end
of each counter and walk steadily toward you. Pull the tap and a full mug slides
down the counter; the customer at the front of that line catches it, is shoved
back while they drink, and lobs the empty mug back at you. Catch the empties.
Let one reach the end of the counter unattended and it smashes; let a full mug
run off the far end and it spills; let a customer walk all the way to the tap and
they haul you over the counter. Any of the three costs a life.

Push every customer in the wave off the far end of their counter and the round is
yours — the next one brings more of them, walking faster.

The whole game is one screen, four lanes, two verbs (move, pour). All the depth
comes from the fact that the mug you poured five seconds ago is still travelling
and will need catching in a lane you have since left.

## Layout

The canvas is 640 × 480. Four counters run horizontally:

| Constant | Value | Meaning |
|---|---|---|
| `BAR_LEFT` | 48 | far end of a counter (customers enter, mugs spill) |
| `BAR_RIGHT` / `TAP_X` | 588 | the taps — where you stand |
| `LANE_TOP` | 96 | y of counter 0's surface |
| `LANE_SPACING` | 98 | vertical gap between counters |
| `laneY(l)` | `LANE_TOP + l * LANE_SPACING` | 96, 194, 292, 390 |

Every moving thing is a point `x` on a counter plus a lane index; there is no
2D collision, only 1D overlap tests within a lane. `y` is derived from the lane
at draw time. Mugs slide along the counter surface, customers stand behind it.

## Entities

**Barman** — `{ lane }`, always at `x = TAP_X`. Lane changes are instantaneous
(see Assumptions).

**Mug** — `{ lane, x, full }`. A full mug travels left at `MUG_SPEED` (300 px/s);
an empty travels right at `EMPTY_SPEED` (230 px/s). One array, `mugs`, holds both.

**Customer** — `{ lane, x, state, drink, hold, kind }`.

- `advancing` — walks right at `customerSpeed(level)`.
- `drinking` — is shoved left at `PUSH_SPEED` (250 px/s) for `DRINK_TIME`
  (0.75 s), a shove of ~187 px per mug. The counter is 540 px long, so a
  customer who has walked most of the way to the taps needs three mugs to be
  seen off.

`hold` counts mugs caught but not yet returned; when the drink timer runs out
the customer throws back one empty per held mug, spaced 30 px apart so they
arrive in sequence, and resumes advancing.

## Rules

1. **Pour.** `pour()` puts a full mug in the barman's lane at the taps, subject
   to a `POUR_COOLDOWN` of 0.25 s.
2. **Serving.** A full mug is caught by the *rightmost* customer in its lane
   whose body it overlaps, whatever that customer is doing. Catching scores
   `SERVE_POINTS` (50) and starts or refreshes the drink timer.
3. **Seeing a customer off.** A customer shoved past `BAR_LEFT` leaves happy for
   `CUSTOMER_POINTS` (150); any mugs they were holding are thrown back first.
4. **Empties.** An empty reaching `TAP_X` is caught for `CATCH_POINTS` (25) if
   the barman is in that lane, and smashes otherwise.
5. **Losing a life** — `lastLoss` records which of the three it was:
   - `spill` — a full mug reached `BAR_LEFT` with nobody to catch it;
   - `shatter` — an empty reached the taps and the barman was elsewhere;
   - `grabbed` — a customer reached the taps.
   The board is cleared, the wave restarts from zero, and the score and level
   are kept. Three lives; at zero the game ends.
6. **Waves.** `waveSize(level)` = `min(4 + 2 × level, 16)` customers arrive one
   at a time in random lanes every `spawnInterval(level)` seconds. The wave is
   clear once all of them have been spawned, served and the counters are empty
   of mugs — so the last empty still has to be caught. Clearing pays
   `waveBonus(level)` = 250 × level.
7. **Difficulty.** `customerSpeed(level)` = `min(30 + 7 × (level − 1), 95)` px/s,
   always far below `MUG_SPEED`, so a poured mug can always overtake the line.
   `spawnInterval(level)` = `max(3.4 − 0.28 × (level − 1), 1.3)` s.

## Controls

| Input | Action |
|---|---|
| `↑` `↓` / `W` `S` | move between counters |
| `Space` | pull the tap (also starts the game when idle or after game over) |
| `Enter` | start / restart |
| `P` | pause / resume |
| Click on the canvas | move to that counter and pour |

## Code shape

`game.js` is a single classic (non-module) script, matching Snake, Tetris,
BurgerTime and the rest of this repo: every piece of state and every helper is a
plain global, so Playwright specs can read and drive them directly through
`page.evaluate`.

All motion is expressed per second and applied by `step(dt)`; `draw()` is pure
rendering and touches no state. The animation loop is just
`step(dt); draw(); requestAnimationFrame(frame)`.

`step(dt)` runs in this order: state timers (dying, wave clear) → pour cooldown →
customer spawning → customers → mugs and their collisions → wave-clear check.
Any life lost returns from `step` immediately, so a single frame can never cost
two lives.

### Test hooks

Three globals exist for the specs and are inert in normal play:

- `autoStep` — when set to `false`, the animation frame stops calling `step()`,
  so a spec owns the clock completely and nothing advances between evaluates.
  `draw()` keeps running.
- `spawnEnabled` — switches off automatic customer arrivals so a spec can place
  exactly the customers it wants to reason about.
- `serveWaveForTest()` — empties the counters and marks the wave fully spawned,
  the shortest path to the wave-clear transition.

## Assumptions

Recorded per the standing instruction to pick the simpler reading, note it and
carry on.

- **Branch name.** The task asks for a branch named after the game
  (`soda-tapper`), but this session is also required to develop and push on the
  designated branch `claude/loving-euler-vm342p`. The designated branch wins;
  no `soda-tapper` branch is created.
- **Instant lane changes.** The barman teleports between counters rather than
  sliding. It is what the original arcade cabinet's four-position control
  effectively does, and it keeps the movement model to a single integer.
- **No branded theming.** *Tapper* was a beer-hall game; this is the soda
  fountain re-skin, so nothing here is alcoholic. The name is deliberately not
  the arcade original's.
- **Drinking customers still catch mugs.** Rather than letting a mug slide
  *through* somebody who is mid-drink, the rightmost customer always catches,
  and the extra mug simply extends the shove and is returned as a second empty.
  Simpler to reason about than "only advancing customers catch", and kinder to
  the player.
- **Customers only leave by being served.** There is no wandering off, so a wave
  is a fixed amount of work.
- **A death restarts the wave, not the level counter.** Score and level survive;
  the customers you had already served in that wave come back.
- **No bonus items.** The arcade original had a tip-jar/dancing-girl distraction
  and a between-level shell game. Both are separate mini-games; neither is
  needed to make the core loop work, so both are left out.
- **Random lane choice for arrivals.** Arrivals use `Math.random()` for the
  lane. Specs that care about placement switch `spawnEnabled` off and call
  `spawnCustomer(lane, x)` themselves, so no spec depends on the RNG.
