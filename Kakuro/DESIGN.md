# Kakuro — Design

## Game concept

Kakuro (also called "Cross Sums") is a logic puzzle — a number crossword. The
board is a grid of black **clue** cells and white **entry** cells. Every
horizontal or vertical strip of consecutive white cells is a *run*. A clue cell
carries a target sum for the run that starts immediately to its right (upper
number) and/or the run that starts immediately below it (lower number).

The player fills each white cell with a digit **1–9** so that:

- every run adds up to its clue's target sum, and
- **no digit repeats** within a single run.

The puzzle is solved when every white cell holds a digit and every run is
satisfied.

## Mechanics

- **Board** — a rectangular grid. Cell `(0,0)`, the top row, and the left column
  are clue/black cells, as in standard Kakuro. Interior cells are either white
  (fillable) or black spacers, and each black cell that sits just left of / just
  above a white run holds that run's clue sum.
- **Runs** — computed once when a puzzle loads: for every black cell, the
  maximal strip of white cells to its right is its *right run*, and the strip
  below it is its *down run*. Each white cell belongs to exactly one right run
  and one down run.
- **Entry** — the player selects a white cell and types a digit 1–9; typing over
  a value replaces it; `0`/`Backspace`/`Delete` clears it.
- **Live feedback** — a run is highlighted **red** as soon as it is full and
  either its digits repeat or its sum is wrong, so mistakes surface immediately;
  a fully-correct completed run is tinted green. Incomplete runs stay neutral.
- **Win** — when `isSolved()` is true (all white cells filled, every run valid)
  the timer stops and a "Solved!" overlay appears with the elapsed time.
- **Timer & best** — elapsed seconds are shown while playing; the best (fastest)
  completion time per puzzle is stored in `localStorage` under `kakuro-best` (a
  JSON map keyed by puzzle index).

### Winning is by the rules, not by matching a stored answer

`isSolved()` checks the *rules* (every run sums correctly with distinct digits),
not equality against the bundled solution. Any rule-satisfying fill wins. The
bundled puzzles are nonetheless designed so their clue sums admit a **single**
valid fill (verified by an exhaustive solver during authoring), so there is a
genuine unique answer to find.

## Controls

- **Click** a white cell — select it.
- **1–9** — place a digit in the selected cell.
- **0 / Backspace / Delete** — clear the selected cell.
- **Arrow keys** — move the selection to the nearest white cell in that direction.
- **New / Restart button** — clear all entries for the current puzzle.
- **Next button** or **N** — load the next puzzle (wraps around).

## Architecture

Following the repo convention (Snake, Sudoku, Nonogram), the game is a single
classic (non-module) script `game.js` with all state and logic exposed as plain
top-level globals so the Playwright tests can reach them via `page.evaluate`:

- `PUZZLES` — the bundled puzzle set: each `{ name, template, solution }` where
  `template` marks `#` (black) and `.` (white) cells and `solution` gives the
  intended digits. **Clue sums are derived in code from the solution**, so the
  data can never carry an inconsistent hand-typed sum.
- `grid` — the live board: each cell is `{ type: 'block', right, down }` or
  `{ type: 'white', value }` (`value` is `0` when empty).
- `runs` — `[{ cells: [{r,c}...], sum }]`, precomputed per puzzle.
- `state` — `'playing' | 'solved'`.
- `selected` — `{ r, c }` or `null`.
- `loadPuzzle(i)`, `restart()`, `nextPuzzle()`, `selectCell(r,c)`,
  `moveSelection(dr,dc)`, `setCell(r,c,v)`, `clearCell(r,c)`.
- `runValid(run)`, `runComplete(run)`, `isSolved()`.
- `tick(dt)` advances the timer; the render loop calls it, and it is separate
  from all puzzle logic so tests stay deterministic and never depend on
  `requestAnimationFrame` timing.

Rendering (`draw()`) is separated from state; tests never rely on it.

## Assumptions

- **Simpler interpretation chosen — a fixed, bundled puzzle set** rather than an
  infinite random generator. Authoring guaranteed-unique Kakuro puzzles at
  runtime is expensive; three hand-verified puzzles of increasing size give a
  clean, deterministic, fully-testable game. This is noted here per the task's
  "pick the simpler interpretation" guidance.
- **Clue sums are derived from the bundled solution** at load time, so the puzzle
  data cannot contain an arithmetic mistake; the solutions were generated and
  their uniqueness verified by an exhaustive solver during authoring.
- **Win = rules satisfied**, not answer-matched (see above), which is the honest
  Kakuro definition and lets the game accept any valid fill.
- **Digits 1–9 only**, standard Kakuro; no zeros in entries.
- Best *time* per puzzle persists in `localStorage`; clearing storage resets it.
