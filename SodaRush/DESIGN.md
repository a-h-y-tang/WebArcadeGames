# Soda Rush — Design

## Concept

A four-counter diner shift. You are the only server behind the taps on the right
of the screen; four counters run away from you towards the door on the left.
Thirsty customers come in through the door and shuffle up the counters towards
you. Pour a soda and it slides down the counter away from you: the first thirsty
customer it meets grabs it and is shoved back towards the door. A customer whose
thirst is fully quenched turns round, walks out, and shoves their **empty mug**
back up the counter — which you have to be standing in front of to catch.

The tension is that every soda you pour is a commitment. It costs you a life if
nobody catches it, and the empty it eventually produces costs you a life if you
have wandered off to another counter by the time it rolls back.

This is the repo's take on the lane-serving arcade genre (Tapper); nothing else
in the collection plays like it.

## Mechanics

### Losing a life

Three ways, all equally fatal:

1. **A customer reaches the taps.** Any customer that walks past
   `CUSTOMER_LIMIT` (34px short of the serving end) has got to you.
2. **A soda falls off the far end.** A full mug that reaches `BAR_LEFT` without
   being caught smashes on the floor.
3. **An empty rolls in to the wrong counter.** A returning empty that reaches
   `BAR_RIGHT` while the server stands in a different lane smashes.

A lost life wipes both counters clear (`customers` and `mugs` are emptied) so
play restarts from a clean board, and the wave's `spawned` counter winds back to
`served` so the customers that were wiped off are re-sent — otherwise a wave
could become impossible to complete.

### Scoring

| Event | Points |
|---|---|
| Customer served and walked out | `100 × level` |
| Empty mug caught at the taps | `50` |

The best score is persisted to `localStorage` under `sodarush-best`.

### Waves and difficulty

A level is one wave of customers. Clearing it requires serving `4 + 2 × level`
customers **and** having nothing left on the counters. Three dials turn with the
level:

| Dial | Formula | Level 1 | Level 5 |
|---|---|---|---|
| Customers per wave | `4 + 2·lvl` | 6 | 14 |
| Customer walk speed | `22 + 6·lvl` px/s | 28 | 52 |
| Spawn interval | `max(1.1, 3.4 − 0.25·lvl)` s | 3.15 | 2.15 |
| Sodas needed per customer | `lvl ≥ 3 ? 2 : 1` | 1 | 2 |

From level 3 a customer needs two sodas: the first one shoves them back but
leaves them thirsty, so they turn round and come at you again.

### Entity model

Three arrays hold everything:

- `customers` — `{ lane, x, state, thirst, speed }`, where `state` is
  `'advancing'` (walking at you) or `'retreating'` (satisfied, walking out).
- `mugs` — both directions in one array, distinguished by `empty`:
  a poured soda has `vx < 0`, a returning empty has `vx > 0`.
- `splashes` — purely cosmetic smash markers with a short lifetime.

Mug/customer contact is a 1-D proximity test inside a single lane
(`|customer.x − mug.x| ≤ CATCH_DIST`), which keeps collision decidable and
makes the rules easy to assert in tests. Empties deliberately pass straight
through customers: only full sodas are catchable by anyone but the server.

### Step order

`step(dt)` runs a fixed order so that a life lost mid-frame cannot leave half a
frame applied to entities that no longer exist:

1. spawning (skipped when `autoSpawn` is off)
2. mugs — movement, catches, smashes
3. customers — movement, arrival at the taps, departures
4. splashes
5. wave-completion check

Steps 2 and 3 return a boolean meaning "a life was lost"; `step` returns
immediately in that case, because `loseLife()` has already emptied the arrays.

## Controls

| Input | Action |
|---|---|
| <kbd>↑</kbd> / <kbd>W</kbd> | Move up one counter |
| <kbd>↓</kbd> / <kbd>S</kbd> | Move down one counter |
| <kbd>Space</kbd> | Pour a soda and slide it down the current counter |
| <kbd>P</kbd> | Pause / resume |
| <kbd>Space</kbd> (idle / game over) | Start a new shift |

## Code layout

| File | Contents |
|---|---|
| `index.html` | HUD, canvas, overlay, key legend |
| `style.css` | Diner-neon palette shared with the rest of the collection |
| `game.js` | Single classic script: constants, state, simulation, rendering, input |
| `tests/sodarush.spec.js` | 72 Playwright specs |

`game.js` is deliberately a non-module script so every constant, state variable
and helper is a plain global, which is what lets the Playwright suite drive the
simulation directly (`step(dt)`, `spawnCustomer(lane)`, `serveSoda()`,
`loseLife()`) instead of trying to play the game through synthetic input. This
mirrors Gold Runner, Snake and Tetris in this repo.

Two test hooks exist on purpose and are never touched by `startGame()`:

- `autoStep` — switch off to stop `requestAnimationFrame` advancing the
  simulation behind a spec's back, leaving time under the spec's control.
- `autoSpawn` — switch off to stop the automatic customer stream, so a spec can
  place exactly the customers it cares about.

All motion is expressed in pixels per second and applied through `step(dt)`, so
60 calls with `dt = 1/60` is exactly one simulated second regardless of how
fast the machine running the tests happens to be.

## Testing

Developed test-first: `tests/sodarush.spec.js` was written against the intended
API before `game.js` existed, then the implementation was written to satisfy it.
Three specs had to be corrected during that loop — two referenced in-page
constants from Node, and one poured a soda into the lane whose customer was
meant to trigger the life loss, so the soda was caught before the life could be
lost. Groups covered: idle state, starting, lane movement, pouring, customers,
serving and scoring, returning empties, lives and game over, pausing, waves and
levels, rendering.

One spec plays a whole wave end to end through the public API — spawn a
customer, pour until they have had enough, let them walk out, catch the empty,
six times over — and asserts the level ticks over with all three lives intact
and a score of exactly 900. Written as a loop over the *initial* `goal`, because
the first draft looped on `served < goal` and, since clearing a wave resets
`served` and raises `goal`, cheerfully played six levels before the guard
stopped it.

```
npx playwright test SodaRush/tests/
```

## Assumptions

Decisions taken autonomously where the brief was open, always choosing the
simpler reading:

1. **Branch name.** The task asked for a branch named after the game
   (`soda-rush`), but this session's standing git instructions pin all
   development and pushes to `claude/compassionate-ramanujan-4cihgu`. The
   session branch wins; no `soda-rush` branch was created.
2. **No horizontal movement for the server.** In the arcade original the
   bartender also runs left and right along the bar. Here the server's position
   is purely lane-based at a fixed `x`, so catching an empty is a question of
   being in the right lane at the right time and nothing else.
3. **One mug per keypress, no pour cooldown.** Holding the counter well stocked
   is the player's problem; spamming sodas is self-punishing because every
   uncaught mug costs a life.
4. **A customer's thirst is fixed by level, not random.** `thirst` is 1 below
   level 3 and 2 from level 3 on, so difficulty is predictable and testable.
5. **No interstitial between waves.** The level counter ticks over and play
   continues; there is no "LEVEL 2" screen to dismiss.
6. **A lost life does not pause the game.** The counters clear and play resumes
   immediately, with a 1.2s breather before the next customer walks in.
7. **Empties are not catchable by customers.** Only full sodas can be grabbed;
   a returning empty passes through anybody still on the counter.
8. **Tips, bonus rounds and the moving-crate bonus stage of the original are
   out of scope.** The core serve/catch loop is the whole game.
9. **Theme.** A soda bar rather than a bar serving alcohol, keeping it in line
   with the family-friendly tone of the rest of the collection.
