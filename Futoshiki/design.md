# Futoshiki — Design

## Game concept

Futoshiki ("not equal") is a Japanese logic puzzle played on an *n×n* grid. The
goal is to fill every cell with a number from **1 to n** so that:

1. **Latin square** — each number appears exactly once in every row and every
   column (no repeats).
2. **Inequalities** — the `<` / `>` signs printed between some adjacent cells
   must hold for the two numbers they sit between.

Some cells start pre-filled (**givens**). You deduce the rest. This
implementation ships four hand-verified **5×5** puzzles of increasing
difficulty (Easy → Expert), each with a **unique** solution.

## Mechanics

- **Board** — an `n×n` grid rendered on an HTML5 canvas, with inequality signs
  drawn in the gaps between adjacent cells.
- **Givens** — fixed cells that cannot be edited (drawn in a muted colour).
- **Entry** — select any editable cell and type a digit `1..n`; type `0`,
  `Backspace`, or `Delete` (or click **Clear**) to empty it. A clickable number
  palette provides the same input for mouse-only play.
- **Conflict highlighting** — a cell is flagged (red) when it breaks a rule that
  is *already decidable*: it duplicates another filled number in its row or
  column, or an inequality to a filled neighbour is violated. Empty cells and
  inequalities with an empty endpoint are never flagged, so the board only ever
  calls out real mistakes.
- **Win** — the moment the grid is completely filled with **no** conflicts, the
  puzzle is solved: a "Solved!" overlay appears. Because each shipped puzzle has
  a unique solution, "complete + no conflicts" is equivalent to "correct".
- **Hint** — reveals one correct value in a random empty cell (from the stored
  solution). Handy when stuck; using it does not end the game.
- **Puzzle select** — Easy / Medium / Hard / Expert buttons load the
  corresponding puzzle; **Restart** clears everything back to the givens.

## Validation model

All rule-checking is pure and synchronous, which keeps the game deterministic
and directly testable:

- `hIneq(r, c)` / `vIneq(r, c)` return the sign (`'<'`, `'>'`) between a cell
  and its right / bottom neighbour, or `null`.
- `cellConflict(r, c)` is `true` iff the (filled) cell at `r,c` duplicates a
  filled value in its row or column, or violates an inequality against a filled
  neighbour.
- `isComplete()` is `true` when no cell is empty.
- `isSolved()` is `isComplete()` with zero conflicting cells.

The render loop reads this state; it is not part of the logic, so tests arrange
a grid, call the pure functions, and assert the result without any timing.

## Controls

| Input | Action |
|---|---|
| Click a cell | Select it (if editable) |
| Arrow keys | Move the selection |
| `1`–`5` | Enter that number in the selected cell |
| `0` / Backspace / Delete | Clear the selected cell |
| Number palette / Clear button | Same as the keys, for the mouse |
| Easy / Medium / Hard / Expert | Load that puzzle |
| Restart | Reset the current puzzle to its givens |
| Hint | Reveal one correct cell |

## Assumptions

- **Filename** — the task prompt asks for `DESIGN.md`, but every existing game
  in this repo (and the root `README.md`) uses a lowercase `design.md`; this
  file follows the repository convention.
- **Fixed 5×5 puzzles, not a runtime generator** — generating a Futoshiki with
  a guaranteed unique solution requires a solver-in-the-loop. Rather than ship a
  generator (and risk a non-unique or unsolvable board), the four puzzles were
  produced offline by a generator that verifies uniqueness with a backtracking
  solver, then embedded as static data. This is the simpler, safe interpretation
  and guarantees every shipped puzzle is fair.
- **Win = complete + consistent** — since each puzzle is unique, the win check
  does not compare against the stored solution; it simply verifies the Latin
  square and inequality rules. The stored solution is used only by **Hint**.
- **Canvas rendering with DOM controls** — the board itself is canvas (matching
  the "HTML5 canvas game" brief and the repo's Sudoku/Nonogram), while buttons
  for palette / difficulty / hint are ordinary DOM elements, as in other games.
