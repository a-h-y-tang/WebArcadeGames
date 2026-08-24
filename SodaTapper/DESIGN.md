# Soda Tapper — Design

## Concept

A single-screen arcade game in the tradition of *Tapper*: you are the sole
soda jerk behind four counters of a busy diner. Thirsty customers shuffle in
from the far end of each counter and march steadily toward your station. You
slide full mugs down the counters to push them back; a customer pushed off the
far end leaves happy — and sends the empty mug sliding back at you, which you
must be standing in the right lane to catch.

Three things end a run: a customer reaching your station, a full mug sliding
off the far end of a counter, or an empty mug crashing past you. Each costs a
life; the third one ends the game.

## Board geometry

The canvas is 720 × 480. Four counters run horizontally, their centre lines at
y = 112, 208, 304 and 400 (`LANE_TOP + i * LANE_H`).

```
 EXIT_X            COUNTER_LEFT                      GRAB_X   SERVER_X
   30                   70                             596      650
    |                    |                               |        |
    |   <- customers advance this way                    |     [ you ]
    +====================================================+========+
        full mugs slide left  <—      —>  empty mugs slide right
```

- `COUNTER_LEFT` (70) — where a new customer steps onto the counter.
- `EXIT_X` (30) — the far lip. A customer pushed past it is *served*; a full
  mug that gets past it *smashes*.
- `GRAB_X` (596) — a customer that reaches this grabs you: a life is lost.
- `SERVER_X` (650) — your station and the tap. Full mugs start here; empty
  mugs must be caught here.

## Mechanics

**Pouring.** `Space` (or `F`) slides one full mug down the lane you are
standing in, moving left at `MUG_SPEED` (330 px/s). A short cooldown
(`TAP_COOLDOWN`, 0.16 s) keeps the tap from being spammed.

**Serving.** A full mug that comes within `HIT_DIST` (22 px) of any customer in
its lane is caught by the nearest one. The customer starts drinking: they slide
left at `PUSHBACK_SPEED` (170 px/s) until they have given back `PUSHBACK_DIST`
(130 px) of ground, then resume advancing. Successive mugs stack more pushback,
so a customer who has walked a long way needs several mugs.

**Satisfied customers.** A customer pushed past `EXIT_X` leaves: `+50 × level`
points, `served` increments, and their empty mug starts sliding right at
`EMPTY_SPEED` (230 px/s).

**Catching empties.** When an empty mug reaches `CATCH_X` (616) you catch it if
you are in that lane — `+100 × level`. If you are elsewhere, it keeps going and
smashes past `SERVER_X + 12`, costing a life.

**Losing a life.** Any of: a customer touching `GRAB_X`, a full mug crossing
`EXIT_X`, an empty mug crossing the station. The counters clear, spawning
pauses for `RESPAWN_DELAY` (1.3 s), and play resumes with one fewer life. At
zero lives the game ends and the best score is written to `localStorage`.

**Levels.** Level *n* requires `LEVEL_BASE + 2n` customers served
(`4 + 2n`). Customers walk at `CUSTOMER_SPEED_BASE + n × CUSTOMER_SPEED_STEP`
(22 + 5n px/s) and arrive every `max(SPAWN_MIN, SPAWN_BASE - n × SPAWN_STEP)`
seconds. Clearing a level awards `100 × level` and shows a short interlude
before the next rush.

## Controls

| Key | Action |
|---|---|
| `↑` / `W` | move up one counter |
| `↓` / `S` | move down one counter |
| `Space` / `F` | pour and slide a mug (also starts the game) |
| `P` | pause / resume |

Clicking the **Start** button does the same as `Space` on the title and
game-over screens; on the pause screen it resumes.

## Code structure

`game.js` is a single classic (non-module) script — no bundler, no modules —
so that every constant, piece of state and function is reachable from the
Playwright specs as a plain global. This mirrors Slime Volley, Kaboom and
Tetris in this repo.

- **Constants** — geometry, speeds and scoring, all at the top.
- **State** — `state` (`'idle' | 'running' | 'paused' | 'over' | 'interlude'`),
  `score`, `lives`, `level`, `served`, `target`, plus the `customers` and
  `mugs` arrays and the `player` object (`{ lane }`).
- **`step(dt)`** — the whole simulation for one slice of time: spawning,
  customers, mugs, collisions, scoring, level and life transitions. It is a
  pure function of the current state and `dt`, so tests drive the game by
  calling `step(1/60)` in a loop instead of waiting on `requestAnimationFrame`.
- **`frame(ts)`** — the rAF loop; converts wall-clock deltas (clamped to
  50 ms) into `step` calls and then `draw()`s.
- **`draw()`** — all rendering; touches no state.
- Test seams: `spawnCustomer(lane)` places a customer deterministically, and
  `spawnEnabled` can be set to `false` to switch off the random arrival timer.

## Assumptions

The task description left several details open. Where it did, the simpler
reading was taken and recorded here:

1. **Branch name.** The task asks for a branch named after the game
   (`soda-tapper`), but this session is required by its operating instructions
   to develop and push on `claude/compassionate-ramanujan-o205h0`. The
   designated branch wins; the game name lives in the folder name instead.
2. **Randomness.** Customer arrivals pick a lane with `Math.random()`. Rather
   than injecting a seeded RNG, the tests disable the arrival timer
   (`spawnEnabled = false`) and place customers themselves, which keeps the
   game code simple and the tests fully deterministic.
3. **Life loss clears the counters.** The arcade original leaves some state
   standing; here everything is swept away and spawning pauses briefly, which
   is both easier to reason about and kinder to the player.
4. **Empty mugs are caught automatically** when you are standing in the lane —
   there is no separate catch key. One fewer thing to press, and lane position
   is already the interesting decision.
5. **Any customer can catch a mug,** including one already drinking. Letting a
   drinking customer soak up another mug avoids the frustrating case where a
   mug sails past a busy customer and smashes.
6. **No sound.** Consistent with the rest of the repo's games.
7. **Fixed 720 × 480 canvas,** not responsive — the same approach every other
   game here takes.
