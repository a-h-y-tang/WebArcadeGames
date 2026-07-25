# Rush Hour — Design

## Concept

Rush Hour is a sliding-block logic puzzle. A 6×6 grid is packed with cars
(length 2) and trucks (length 3). Every vehicle can only slide **along its own
orientation** — horizontal vehicles left/right, vertical vehicles up/down — and
no two vehicles may overlap. One special red car (the **target**, id `X`) sits
on the exit row. The goal is to clear a path and slide the red car off the
right edge of the board through the exit, in as few moves as possible.

## Board model

- The grid is **6×6**. Rows are indexed `0..5` top-to-bottom, columns `0..5`
  left-to-right.
- The **exit** is on the right edge of row `2` (the third row). The target car
  always lies horizontally on that row.
- A **vehicle** is `{ id, r, c, len, orient }`, where `(r, c)` is its
  top-left cell:
  - `orient: 'H'` occupies `(r, c), (r, c+1), … (r, c+len-1)`.
  - `orient: 'V'` occupies `(r, c), (r+1, c), … (r+len-1, c)`.
- `len` is `2` (car) or `3` (truck).

Levels are authored as human-readable 6×6 text grids — one letter per vehicle,
`.` for empty — and parsed into vehicle objects by `parseLevel`. `X` is the red
target car. This keeps the level data legible and makes it trivial to verify by
eye, while the rules operate on the parsed objects.

Example (level 1):

```
...A..
...A..
XX.A..
......
......
......
```

## Mechanics

- **A move** slides one vehicle any number of free cells along its axis. Sliding
  the same vehicle again is a separate move. `moveVehicle(id, delta)` applies a
  signed slide (`delta` cells; sign = direction) only if every cell swept is on
  the board and unoccupied — otherwise it is rejected and does not count.
- The rules are pure functions over the vehicle list — `buildGrid`, `canMove`,
  `moveVehicle`, `isWon` — kept entirely separate from rendering, so the
  Playwright suite can construct an exact position and assert the outcome with
  no timing dependence.
- **Winning** a level: the target car `X` reaches the right wall on the exit
  row (its right cell is column 5). It then slides out through the exit.
- Every bundled level is **guaranteed solvable** — a breadth-first solver in the
  test suite proves each one is solvable and not already solved.

## Controls

- **Click / tap** a vehicle to select it (it highlights).
- With a vehicle selected, **click an empty cell** in line with it to slide it
  as far as it can legally go toward that cell.
- **Arrow keys** slide the selected vehicle one cell:
  - Horizontal vehicle: `←` / `→`.
  - Vertical vehicle: `↑` / `↓`.
- `R` — restart the current level.
- `N` — skip to the next level.
- Any key or the **Start / Next** button begins play from the title or solved
  screen.

## HUD

- **MOVES** — moves made on the current level.
- **LEVEL** — current level number (1-based).
- **BEST** — fewest moves in any single solved level, saved to `localStorage`
  under `rushhour-best`.

## Rendering

An 480×480 canvas divided into a 6×6 grid of 80px cells. Vehicles are drawn as
rounded rectangles spanning their length; the target car is red, other vehicles
are assorted muted colours keyed by id. The selected vehicle gets a bright
outline. A notch on the right edge of the exit row marks the way out. A
translucent overlay shows the title before play and the solved message
afterward.

## Assumptions

These resolve ambiguities in the brief; the simpler interpretation was taken in
each case and recorded here.

1. **A move = one vehicle slide of any distance.** This is the classic Rush Hour
   move definition. Arrow-key nudges move one cell (and so count as one move
   each); a click-to-slide moves as far as legal in a single move.
2. **Fixed, hand-authored levels** rather than procedural generation. Authoring
   guarantees interesting, solvable puzzles; a BFS solvability test guards every
   bundled level. Levels are ordered easy→hard and wrap around at the end.
3. **Win = target reaches the right wall** on the exit row (rather than
   animating fully off the board). Simpler and unambiguous.
4. **"Best" tracks fewest moves across any level**, consistent with the other
   puzzle games in this repo (e.g. Lights Out). It is not per-level.
5. **`N` skips to the next level; `R` restarts the current one.** "New board"
   has no meaning for fixed puzzles, so `N` is repurposed as "next".
6. **Timer/animation-free logic.** Move counting and win detection are
   synchronous and deterministic, keeping tests free of timing dependence.
