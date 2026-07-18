# Pipe Dream — Design

## Concept

**Pipe Dream** (a.k.a. Pipe Mania) is a tile-laying race against a rising flood of
"ooze". A source tile on a grid points in one direction. A queue feeds you a
never-ending stream of random pipe pieces. You place them on empty grid cells,
one at a time, trying to build the longest continuous pipe path leading away from
the source. After a short countdown the ooze starts flowing and creeps forward
one pipe per tick. If it ever reaches an empty cell, the grid edge, or a pipe
whose opening doesn't line up, it **leaks** and the game ends. Fill enough pipes
before the leak and you clear the level.

## Board & pieces

- The grid is **9 columns × 7 rows** of square cells.
- One cell is the **source**: it is not placeable and emits ooze in a fixed
  direction (East on level 1).
- Every pipe piece has a set of open **sides**, encoded as bit flags:
  `N = 1, E = 2, S = 4, W = 8`.

| Piece   | Key    | Open sides | Shape                    |
|---------|--------|------------|--------------------------|
| Horizontal straight | `h`     | `E \| W`   | ──                       |
| Vertical straight   | `v`     | `N \| S`   | │                        |
| Curve N–E           | `ne`   | `N \| E`   | └                        |
| Curve E–S           | `es`   | `E \| S`   | ┌                        |
| Curve S–W           | `sw`   | `S \| W`   | ┐                        |
| Curve W–N           | `wn`   | `W \| N`   | ┘                        |
| Cross               | `cross`| `N\|E\|S\|W`| ┼ (flow passes straight through) |

## Flow rules

Flow is modelled as a head with a position and a **travel direction** (the side
of the current cell it exits from). Each tick (`flowStep`):

1. Look at the neighbour cell in the travel direction.
2. If that neighbour is off the grid, empty, or the source → **leak**.
3. The flow enters the neighbour from the opposite side (`entrySide`). If the
   piece has no opening on `entrySide` → **leak**.
4. Otherwise the neighbour fills. For a two-opening piece the exit side is the
   *other* opening (`openings XOR entrySide`); for a cross the flow goes straight
   through (exit = opposite of entry).
5. A **cross** may be traversed twice — once per axis. Any other already-filled
   pipe (including re-entering a cross on the same axis) is treated as a leak,
   which also prevents infinite loops.
6. `flowLength` (pipes filled) increments on every successful fill. Reaching the
   level **target** sets the state to `won`.

The source counts as fill position 0; the first neighbour it flows into is the
first filled pipe.

## Scoring & levels

- **Score** = `50` per pipe the ooze fills, plus a `250` bonus for clearing the
  level's target.
- **Target** for level *n* is `8 + 2·(n − 1)` pipes.
- Clearing a level advances to the next with a fresh board and higher target.
- A leak before the target is reached ends the run (`lost`).

## Controls

- **Mouse:** click any empty cell to place the piece at the front of the queue.
- **Keyboard:** arrow keys / WASD move a cursor; **Space** or **Enter** places
  the front piece at the cursor. **Enter** on the start overlay also begins.
- **Buttons:** *Start* (begin / restart), *Flow Now* (skip the countdown and
  release the ooze immediately).

## State machine

`ready → flowing → won | lost`

- **ready** — placing pipes; a countdown ticks down to the automatic flow start.
- **flowing** — ooze advances one pipe per tick; placement of *un-flooded* cells
  is still allowed (you can outrun the ooze).
- **won** — target reached; overlay offers the next level.
- **lost** — leak before target; overlay offers a restart.

## Testability

The whole simulation is deterministic and driven by a small `window` API so
Playwright can assert exact outcomes without relying on timers or rendering:

- `window.state`, `window.grid`, `window.queue`, `window.source`,
  `window.cursor`, `window.flowLength`, `window.score`, `window.level`,
  `window.target`
- `window.placeAt(row, col)` — place the front queue piece; returns success
- `window.startFlow()` / `window.flowStep()` — release and advance the ooze
- `window.runFlow()` — step until the flow stops (win/leak)
- `window.setSeed(n)` — seed the piece RNG for a reproducible queue
- `window.loadTest({grid, source, queue, target})` — install an exact scenario
  with **all timers disabled** so assertions are stable
- `window.reset()`, `window.nextLevel()`

Rendering (canvas) is a pure function of that state, so no test needs pixels.

## Assumptions

These resolve ambiguities in the classic design toward the **simpler**
interpretation, as instructed:

1. **Pieces are placed only on empty cells.** The arcade lets you overwrite an
   un-flooded pipe at a time penalty; we drop overwriting entirely.
2. **No dedicated "end" tile.** The goal is purely reaching a pipe-count target,
   rather than routing to a specific drain.
3. **Single source, fixed direction per level** (East on level 1).
4. **The auto-flow countdown and per-tick advance use `setInterval`/`setTimeout`
   in real play only.** Tests install scenarios via `loadTest`, which never arms
   a timer, and drive the flow explicitly — so tests never depend on wall-clock
   timing.
5. **Reaching the target ends the level immediately as a win**, even though a
   real Pipe Mania board would keep flowing; this keeps the win condition crisp.
6. A **cross** is the only tile that may be filled twice (once per axis).
