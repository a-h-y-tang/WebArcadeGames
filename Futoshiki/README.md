# Futoshiki

A [Futoshiki](https://en.wikipedia.org/wiki/Futoshiki) logic puzzle ("not
equal") on an HTML5 canvas. Fill the 5×5 grid so every row and column contains
1–5 exactly once **and** every `<` / `>` sign between adjacent cells holds. Four
hand-verified puzzles, Easy through Expert, each with a single unique solution.

## How to play

- **Click** a cell, then **type 1–5** to place a number (or use the on-screen
  number pad). Type **0** / **Backspace** / **Delete** or click **Clear** to
  empty a cell.
- **Arrow keys** move the selection around the grid.
- The **given** numbers (muted blue) are fixed — you can't change them.
- A cell turns **red** when it breaks a rule that's already decidable: a repeat
  in its row or column, or a `<`/`>` sign that fails against a filled neighbour.
  Empty cells are never flagged.
- Between horizontal neighbours the `<` / `>` points at the smaller number.
  Between vertical neighbours the same is shown as `∧` (top is smaller) / `∨`
  (bottom is smaller).
- Fill the whole grid with **no red cells** and you've solved it.
- Stuck? **Hint** reveals one correct cell. **Restart** clears your entries back
  to the givens. The difficulty buttons load a different puzzle.

### Controls

| Input | Action |
|---|---|
| Click a cell | Select it |
| Arrow keys | Move the selection |
| 1–5 | Enter that number |
| 0 / Backspace / Delete | Clear the cell |
| Number pad / Clear | Same, for the mouse |
| Easy / Medium / Hard / Expert | Load that puzzle |
| Hint | Reveal one correct cell |
| Restart | Reset to the givens |

## Running it

Open `index.html` directly in any modern browser — no build step or server
required.

## How it works

See [design.md](design.md) for the rules, the pure validation model, and the
assumptions made. In short: all rule-checking (`cellConflict`, `isComplete`,
`isSolved`) is pure and reads only the grid, so the game is deterministic and
the render loop is not part of the logic. The four puzzles were generated
offline and each verified to have a **unique** solution by a backtracking
solver, so "complete with no conflicts" is equivalent to "correct".

## Tests

Playwright tests live in [tests/](tests/) and cover initial state and givens,
number entry / clearing (keyboard, palette, fixed-cell protection), selection
and movement, the inequality lookups, conflict detection (row/column duplicates
and violated inequalities), completion and win detection, the Hint feature, and
puzzle selection / restart.

```powershell
npx playwright test Futoshiki/tests/
```
