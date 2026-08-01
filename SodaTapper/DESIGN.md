# Soda Tapper — Design

## Concept

**Soda Tapper** is a lane-management arcade game in the spirit of the 1983
tavern-service coin-ops. You are the soda jerk working four counters at once.
Thirsty customers shuffle in from the left end of each counter and march toward
your tap station on the right. You slide full mugs down a counter to knock a
customer back; when a customer has had enough they leave — but every drink they
take sends an **empty mug** sliding back at you, and you have to be standing in
that lane to catch it.

Three ways to lose a life:

1. A customer reaches your tap station and grabs you.
2. A full mug slides all the way off the far end of a counter (wasted soda).
3. An empty mug comes back down a lane you are not standing in and shatters.

The tension is that all three failures pull you in different directions: serving
means staying put, catching empties means chasing them, and ignoring a lane lets
its customers walk right up to you.

## Mechanics

- **The bar** is a 640×420 canvas with **4 counters** (lanes). Customers enter at
  `BAR_LEFT`; the player's tap station is at `STATION_X` on the right.
- **The player** occupies exactly one lane at a time and moves instantly between
  adjacent lanes (up/down). There is no horizontal movement.
- **Serving.** `serve()` pours a full mug into the player's current lane at
  `MUG_START_X`, travelling left at `mugSpeed()`. A short `SERVE_COOLDOWN`
  throttles how fast mugs can be poured; serving while the cooldown is active is
  a no-op (it returns `false`).
- **Customers** advance right at `customerSpeed()`. Each spawns with
  `drinksPerCustomer()` drinks left.
- **A hit.** When a full mug overlaps a customer in the same lane, the customer
  takes the drink: `drinks -= 1`, the customer is knocked back `PUSH_BACK`
  pixels, the full mug is consumed, and an **empty mug** appears at the point of
  contact travelling right. If a mug overlaps more than one customer, the
  **right-most** (nearest) one takes it.
- **A customer leaves** — scoring `LEAVE_POINTS` — when their drinks reach 0 *or*
  when a knock-back pushes them past `BAR_LEFT` (shoved off the end of the bar).
- **Empty mugs** travel right. Reaching `CATCH_X`, they are caught for
  `EMPTY_POINTS` if the player is in that lane, otherwise they shatter and cost a
  life.
- **Waves.** Wave `n` sends `customersInWave()` customers, released on a
  `spawnInterval()` timer into pseudo-random lanes. The wave is cleared once every
  customer for the wave has spawned and none are left on the bar; clearing awards
  `WAVE_BONUS`, a bonus life (capped at `MAX_LIVES`) and bumps the wave number.
  Any mugs still in flight are cleared with the wave so a leftover empty can't
  cost a life during the lull.
- **Losing a life** clears the bar (all customers and mugs), resets the current
  wave's spawn progress, and restarts the wave after a short grace period. At
  zero lives the game ends and the best score is written to `localStorage`.
- **Scoring** — every award is multiplied by the current wave, so late waves pay
  far more:

  | Event | Points |
  |---|---|
  | Mug drunk by a customer | `SERVE_POINTS × wave` (10) |
  | Customer leaves satisfied | `LEAVE_POINTS × wave` (50) |
  | Empty mug caught | `EMPTY_POINTS × wave` (5) |
  | Wave cleared | `WAVE_BONUS × wave` (100) |

### Difficulty scaling (pure functions of `wave`)

| Quantity | Formula |
|---|---|
| `customerSpeed` | `CUST_BASE + (wave-1) × CUST_STEP` |
| `mugSpeed` | `MUG_BASE + (wave-1) × MUG_STEP` |
| `spawnInterval` | `max(SPAWN_MIN, SPAWN_BASE - (wave-1) × SPAWN_STEP)` |
| `drinksPerCustomer` | `min(MAX_DRINKS, 1 + floor((wave-1) / 2))` |
| `customersInWave` | `WAVE_CUST_BASE + wave` |

## Controls

| Input | Action |
|---|---|
| ↑ / W | Move up one counter |
| ↓ / S | Move down one counter |
| Space | Serve a mug (start / restart when not playing) |
| Mouse move | Jump to the counter under the pointer |
| Click | Serve a mug |
| P | Pause / resume |

## Determinism & testing

The game follows the same shape as the other games in this repo: a single
classic (non-module) script, so every constant, state variable and function is a
plain global reachable from Playwright via `page.evaluate`.

- **Fixed sub-steps.** `step(dt)` advances the world in `1/240 s` slices, so a
  fast mug can never tunnel through a customer and results don't depend on frame
  rate.
- **Seeded RNG.** Lane choice for spawns comes from a `mulberry32` generator;
  `setSeed(n)` reseeds it, so a given seed always produces the same wave.
- **`setAutoStep(false)`.** The `requestAnimationFrame` loop keeps drawing but
  stops advancing the simulation, letting a test call `step(dt)` by hand and
  assert on exact positions with no wall-clock interference. One test leaves auto
  stepping on to prove the real-time loop actually drives the game.
- **Injectable entities.** `spawnCustomer({lane, x, drinks})` and
  `spawnMug({lane, x, empty})` accept explicit positions, so a test can set up a
  precise collision instead of waiting for one to happen.

## Assumptions

These were resolved in favour of the simpler interpretation and are recorded here
as required by the task:

- **Branch name.** The task asks for a branch named after the game
  (`soda-tapper`), but this session is pinned to the designated development
  branch `claude/loving-euler-6wj5lr`. The designated branch wins; the game name
  lives in the folder, commit and PR title instead.
- **Catching empties is positional, not a button.** The arcade original has the
  player collect empty mugs by being in the lane; there is no separate catch key
  here. Standing in the lane when the empty arrives is enough.
- **No tip glasses / bonus round.** The original's coin-drop bonus stage and
  wandering dancer are omitted; the core loop is the deliverable.
- **One tap station, not two.** The player serves from a single fixed x-position
  rather than walking along the bar.
- **Mug-vs-mug collisions are ignored.** Full and empty mugs pass through each
  other; only mug-vs-customer contact matters.
- **Screen shows all four lanes at once** with no scrolling — the whole bar is
  always visible.

## Code map

| File | Contents |
|---|---|
| `index.html` | HUD (score / wave / lives / best), canvas, overlay, help text |
| `style.css` | Shared dark-arcade look used by the other games in this repo |
| `game.js` | Constants, state, simulation (`step`), rendering, input |
| `tests/soda-tapper.spec.js` | Playwright suite driving the globals above |

### `game.js` structure

1. **Constants** — geometry, speeds, scoring, difficulty curve.
2. **RNG** — `mulberry32` + `setSeed`.
3. **State** — `state`, `score`, `best`, `wave`, `lives`, `player`, `customers`,
   `mugs`, `spawnedThisWave`, timers.
4. **Difficulty helpers** — pure functions of `wave`.
5. **Entities** — `spawnCustomer`, `spawnMug`, `serve`, `moveLane`, `setLane`.
6. **Simulation** — `substep` (player-independent world update in a fixed slice)
   and `step` (sub-step driver, HUD refresh).
7. **Game flow** — `startGame`, `loseLife`, `completeWave`, `endGame`,
   `togglePause`.
8. **HUD / overlay**, **rendering**, **main loop**, **input**, **init**.

Within a sub-step the order is deliberate and tested: cooldown → spawn scheduler
→ customers advance (grab check) → mugs move (hit / waste / catch checks) → wave
completion check. Customers move before mugs so a customer can never be knocked
back and then immediately re-advance inside the same slice.
