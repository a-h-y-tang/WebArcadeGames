# Light Up (Akari) — Design

## Concept

A canvas implementation of **Akari** (also known as **Light Up**), the binary-
determination logic puzzle published by Nikoli. You place light bulbs on a grid
so that **every white cell is illuminated**, while obeying two rules: no bulb may
shine on another bulb, and every numbered black wall must touch exactly that many
bulbs. Solve the puzzle and the whole board lights up.

It is a pure deduction puzzle — no timers, no randomness during play — which is
distinct from the repo's action games and from its other logic puzzles (Sudoku,
Nonogram, Minesweeper, Lights Out — note *Light Up* and *Lights Out* are entirely
different games).

## Rules

The board is a 7×7 grid of **white cells** and **black walls**. Some walls carry
a number from 0 to 4.

- A **bulb** lights its own cell and shines outward along its row and column,
  illuminating every white cell until the beam is blocked by a wall or the
  board edge.
- **Every white cell must end up lit.**
- **No bulb may illuminate another bulb** — two bulbs in the same unobstructed
  row or column segment is illegal (a "conflict").
- **A numbered wall must have exactly that many bulbs** in its four orthogonally
  adjacent cells. A `0` wall must have none; blank walls have no such
  constraint.

The puzzle is **solved** the instant all three conditions hold simultaneously.

## Mechanics

- **Left-click / tap** a white cell to place or remove a bulb.
- **Right-click** a white cell to place or remove a small **dot mark** — a play
  aid for noting cells you've decided *cannot* hold a bulb. Marks are cosmetic
  and never affect whether the puzzle is solved. Placing a bulb clears any mark
  on that cell (and you cannot mark a cell that already holds a bulb).
- Live feedback while you play:
  - lit white cells glow warm yellow; unlit cells stay dark,
  - a bulb whose beam hits another bulb is drawn with a red **conflict** ring,
  - a numbered wall turns **green** when its bulb count is exactly right and
    **red** when too many bulbs surround it.
- Four hand-tuned puzzles of increasing size ship with the game; clearing one
  offers the next, and finishing the last loops back to the first.

## Controls

| Input | Action |
|---|---|
| **Left-click / tap** | Place or remove a bulb |
| **Right-click** | Place or remove a "no bulb" dot mark |
| **Enter / Space / Click** | Start (from the title overlay) |
| **N** | Next puzzle (after solving) |
| **R** | Reset the current puzzle |

## Architecture

The code keeps a strict split between **logic** and **rendering** so the
Playwright suite can drive it deterministically — Akari has no animation, so
every rule is a pure function over integer grids, exactly the style used by the
repo's other logic games.

- Board state lives in top-level globals the tests read and write directly:
  `wall` (2D boolean), `num` (2D number: `null` = white, `-1` = blank wall,
  `0..4` = numbered wall), `bulbs` and `marks` (2D booleans), plus `state`,
  `levelIndex`, and the embedded `levels` data.
- Pure helpers express the rules: `isWall`, `wallNum`, `computeLit`, `isLit`,
  `bulbConflict`, `adjBulbCount`, `wallSatisfied`, and `isSolved`. None of them
  touch the canvas or the clock.
- `toggleBulb(r, c)` / `toggleMark(r, c)` are the only mutators during play;
  `toggleBulb` calls `checkWin()` so placing the final correct bulb wins
  immediately.
- `draw()` is the only function that renders to the canvas.

## Puzzles

The four shipped puzzles were produced offline by a **solution-first generator**:
random walls are laid down, a valid light-up solution is found, every wall is
then numbered with its exact adjacent-bulb count, and the resulting numbered
puzzle is accepted only if a backtracking solver confirms its solution is
**unique**. Each puzzle's grid *and* its verified solution are embedded so the
test suite can place a known-good solution and assert the win.

## Assumptions

Where the brief was open-ended, the simpler interpretation was chosen and noted
here:

1. **Fixed 7×7 puzzles, not procedurally generated at runtime.** Generating
   guaranteed-unique Akari puzzles is expensive; instead a small set is
   generated and verified offline, then shipped. This keeps play instant and the
   puzzles provably fair (unique solution).
2. **Rule-based win, not solution-matching.** The game checks the three Akari
   rules rather than comparing against the stored solution, so any legal
   configuration wins. Because every shipped puzzle has a unique solution, this
   is equivalent in practice but keeps the logic honest to the actual rules.
3. **Marks are purely a play aid** — they carry no logical meaning and are
   ignored by the solved check.
4. **Progress is not persisted** across reloads (no `localStorage`), keeping the
   test suite free of external state.
