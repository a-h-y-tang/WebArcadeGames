# Calcudoku — Design

## Concept

Calcudoku (a KenKen-style puzzle, also called *Mathdoku*) is a logic puzzle that
combines a Latin square with arithmetic. On an N×N grid you must place the digits
1..N so that:

1. every **row** contains each digit exactly once,
2. every **column** contains each digit exactly once, and
3. every outlined **cage** (a group of cells) combines its digits to a printed
   **target** using a printed **operation** (+, −, ×, ÷).

It shares the Latin-square backbone of Sudoku but adds arithmetic cages, so it is
mechanically distinct from every other puzzle in the repo.

## Mechanics

- **Cages.** Each cage shows a clue in its top-left cell, e.g. `12×` (the cells
  multiply to 12), `1−` (the two cells differ by 1), `2÷` (one cell is twice the
  other), or a bare number (a single "given" cell fixed to that value).
- **Operators.** `+` and `×` apply to cages of any size (sum / product of all
  cells). `−` and `÷` apply only to two-cell cages, comparing the larger value to
  the smaller (`|a−b|` and `max/min`). A single-cell cage is just a given.
- **Entry.** Select a cell and type a digit 1..N. `0`, `Backspace`, or `Delete`
  clears it.
- **Live conflict feedback.** While playing, a cell is tinted red if its digit is
  repeated in its row or column, or if it belongs to a fully filled cage that
  misses its target. This is guidance only — you are never blocked from entering
  a digit.
- **Winning.** When the grid is a complete Latin square *and* every cage is
  satisfied, the game switches to the `won` state and a "SOLVED!" overlay appears.

## Controls

- **Click** a cell to select it.
- **1–N** enter a digit; **0 / Backspace / Delete** clear it.
- **← ↑ ↓ →** move the selection.
- **Space / Enter / Click** start from the title screen.
- **R** restart (clears the grid).

## Architecture

State lives in module-level globals (matching the repo convention) so the
Playwright suite can inspect and drive it:

- `SOLUTION` — the N×N solved Latin square (also the answer key).
- `CAGES` — each cage as `{ cells: [[r,c],…], op, target }`, where `op` is one of
  `+ - x / =`.
- `grid` — the live N×N array of entered values (0 = empty).
- Pure logic, separated from rendering:
  - `cageSatisfied(cage, vals)` / `isCageSolved(i)` — the arithmetic check.
  - `isSolved()` — true iff the grid is a full Latin square and every cage holds.
  - `conflictSet()` — the `"r,c"` cells currently breaking a rule (for the red
    highlight).
- Helpers shared with the tests: `valueAt`, `solutionAt`, `setValue`,
  `selectCell`, `moveSelection`.

Rendering is a plain 2D canvas redrawn on every change (nothing animates): cell
backgrounds and the selection, thin interior grid lines, thick cage outlines
(drawn on any edge between two different cages), the clue label in each cage's
anchor cell, and the entered digits. The HUD (`#filled`, `#status`) is DOM text
kept in sync by `updateHud()`.

### Puzzle generation

The bundled puzzle was produced by an offline generator: it takes a chosen Latin
square and a cage partition, then searches operator/target assignments and keeps
one whose puzzle has **exactly one solution**. Because the clues are derived from
a real solution and the assignment is verified unique, the puzzle is guaranteed
consistent and uniquely solvable. The `puzzle integrity` tests re-check the
structural guarantees (the solution is a Latin square, cages cover every cell
once, −/÷ cages are two cells, and the stored solution satisfies every cage).

## Assumptions

- **Single fixed 4×4 puzzle.** Rather than generate puzzles at runtime, the game
  ships one hand-verified, uniquely solvable board. This is the simpler, fully
  deterministic interpretation and keeps the tests reliable; larger boards and a
  puzzle library are natural extensions.
- **Win checks the rules, not the stored solution.** Because the puzzle is
  unique, satisfying the rules *is* reproducing the solution — but the code
  checks the rules directly (Latin + cages), which is the correct Calcudoku
  win condition.
- **Conflicts are advisory.** Illegal digits are highlighted but never rejected,
  so the player can experiment freely.
- **No timer or scoring.** Like the other logic puzzles here, the only goal state
  is a completed grid.
