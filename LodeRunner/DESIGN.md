# Lode Runner — Design

A single-screen dig-and-collect platformer on an HTML5 canvas. The runner
gathers every piece of gold on a level while guards hunt them across girders,
ladders and ropes. The runner cannot jump and cannot fight — the only weapon is
a shovel that melts a hole in the brick floor beside them. Guards fall in, the
runner walks over their heads, and the brick grows back a few seconds later,
burying anything still inside.

## Game concept

- Three hand-built levels, each a 24 x 16 tile grid drawn on one 672 x 448
  canvas. No scrolling, no build step — `index.html` runs straight from disk.
- Collect all the gold on a level to reveal the level's hidden **exit ladder**;
  climb it to the top row to advance.
- Three lives. Touching a live guard, or standing in a hole when the brick
  regrows, costs one. At zero lives the run is over; finishing level 3 wins.

## Tiles

The levels are authored as arrays of 16 strings of 24 characters each:

| Char | Tile | Behaviour |
|---|---|---|
| (space) | empty | fall through |
| `#` | brick | solid, **diggable** |
| `@` | stone | solid, never diggable |
| `H` | ladder | climb up/down, supports whoever stands on it |
| `-` | rope | hang and traverse; press down to let go |
| `$` | gold | passable, collected on contact |
| `E` | exit ladder | empty until all gold is collected, then a ladder |
| `P` | runner spawn | becomes empty |
| `G` | guard spawn | becomes empty |

Level data is validated at load: every level is `ROWS` rows of exactly `COLS`
characters with exactly one `P`, at least one `$` and at least one `E`.

## Mechanics

### Movement (both runner and guards)

Motion is **axis-locked and grid-aligned**: an actor moves horizontally only
when its centre is aligned with a row, and vertically only when aligned with a
column, snapping to the lane it enters. That keeps collisions to simple tile
lookups while the motion itself stays smooth and frame-rate independent — every
speed is expressed in pixels per second and integrated by `step(dt)`.

- **Supported** when standing on brick/stone/ladder, standing *in* a ladder
  cell, hanging on a rope, or standing on a trapped guard's head.
- **Unsupported** actors fall at `FALL_SPEED`. A fall stops on the first row
  whose landing test passes; ladders catch a falling actor, ropes do not.
- **Up** requires the actor to be in a ladder cell. Climbing off the top of a
  ladder stops on the cell above it.
- **Down** climbs a ladder below, steps off a floor edge, or drops from a rope.
- Vertical input wins over horizontal when a vertical move is legal, so a
  ladder is never "sticky".

### Digging

`Z` digs down-left, `X` digs down-right (`,` / `.` also work). A dig is legal
only when the runner is aligned on a row, standing on solid ground (not on a
ladder or rope, not mid-fall), the target tile diagonally below is **brick**,
and the tile directly beside the runner is clear. The brick becomes a hole
immediately and the runner is locked for `DIG_TIME` while the shovel swings.

A hole refills after `HOLE_REFILL` seconds, flashing for the last
`HOLE_WARN` seconds. Whoever is inside when it closes is crushed: the runner
loses a life, a guard is buried for points and respawns.

### Guards

- Guards re-plan every `PLAN_INTERVAL` seconds using a breadth-first search over
  the tile graph (left/right when standable, up a ladder, down into any
  non-solid cell) and step toward the first cell of the path. With no path they
  fall back to shuffling horizontally toward the runner.
- A guard that ends up inside a hole is **trapped**: it stops, stops being
  lethal, and becomes a platform the runner can walk over. After
  `TRAP_ESCAPE` seconds it climbs out to the cell diagonally above, preferring
  the side the runner is on.
- Guards pick up gold they walk over and drop it again after `GUARD_DROP_TIME`
  seconds, or immediately when trapped. Gold carried by a guard still counts
  as uncollected, so a hoarding guard has to be trapped before the exit can
  appear. A guard buried while carrying gold returns it to a free cell so a
  level can never become unwinnable.
- Guards get slightly faster on each level, capped below the runner's speed.

### Scoring

| Event | Points |
|---|---|
| Gold collected | 250 |
| Guard trapped in a hole | 75 |
| Guard buried by a refilling brick | 150 |
| Level completed | 1500 |

Best score is persisted in `localStorage` under `loderunner-best`.

## Controls

| Key | Action |
|---|---|
| `←` `→` / `A` `D` | run, or traverse a rope |
| `↑` `↓` / `W` `S` | climb a ladder, drop from a rope |
| `Z` or `,` | dig down-left |
| `X` or `.` | dig down-right |
| `R` | give up on the level (costs a life) |
| `P` | pause / resume |
| `Space` / `Enter` | start, or restart after game over |

## Code layout

`game.js` is a single classic (non-module) script, matching Snake, BurgerTime
and Kaboom! in this repo, so its state and helpers are reachable from the
Playwright specs as plain globals. Sections in order:

1. **Constants and level data** — tile codes, speeds, timings, the three levels.
2. **Grid helpers** — `tileAt`, `isBlocking`, `isLadderAt`, `isRopeAt`,
   `colOf`/`rowOf`, `cx`/`cy`.
3. **Actors** — `moveActor` (the shared axis-locked mover), `fall`, digging.
4. **Guards** — BFS planner, trapping, gold carrying, respawn.
5. **Game flow** — `startGame`, `loadLevel`, `killRunner`, `completeLevel`.
6. **`step(dt)`** — the whole simulation, called by the render loop and driven
   directly by the tests.
7. **`draw()`**, HUD/overlay, input handling, `requestAnimationFrame` loop.

All simulation lives behind `step(dt)`; `draw()` never mutates state. Tests
call `step` with a fixed `dt` so no assertion depends on wall-clock timing.

## Testing

`tests/loderunner.spec.js` drives the real page over `file://` with Playwright.
The specs place actors with `placeRunner`/`placeGuard`, freeze guards with
`guardsEnabled = false` for movement tests, and search the loaded grid for the
tile shape a test needs (a brick floor, a ladder, a rope) rather than hard
coding level coordinates, so level tweaks do not break the suite.

## Assumptions

Made autonomously while building this, per the task's instruction to pick the
simpler reading and keep going:

- **Branch name.** The task asked for a branch named after the game
  (`lode-runner`), but this session is pinned to the branch
  `claude/loving-euler-mwnmx0` and is told never to push elsewhere. The pinned
  branch wins; the game name lives in the folder name instead.
- **Digging is instant.** The hole appears the moment the dig is accepted and
  the runner is simply locked for `DIG_TIME`, rather than animating a brick
  crumbling over several frames. It keeps the dig deterministic for tests.
- **Death is instant.** No death animation or freeze frame: a life is lost, the
  runner and guards return to their spawns, holes are filled back in, and
  collected gold stays collected.
- **Guards escape holes by stepping out.** Rather than animating a climb, a
  guard whose trap timer expires is placed on the cell diagonally above the
  hole (runner's side preferred, other side as fallback).
- **Ladders catch falls, ropes do not.** The original is inconsistent between
  ports; catching on ladders is the friendlier reading.
- **Three levels, then a win.** Rather than looping forever, clearing level 3
  ends the run with a `won` state and the final score.
- **Guard gold is simplified** to one nugget per guard with a fixed drop timer,
  instead of the original's random hoarding behaviour, so the suite stays
  deterministic.
