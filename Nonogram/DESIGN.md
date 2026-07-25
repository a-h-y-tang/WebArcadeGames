# Nonogram (Picross) — Design

## Concept

Nonogram — also known as *Picross* or *Griddlers* — is a picture-logic puzzle. A
hidden black-and-white picture lives on a grid. Each **row** and **column** is
labelled with a run-length clue: the sizes, in order, of the consecutive blocks
of filled cells in that line. From the clues alone the player deduces which cells
are filled and reveals the picture.

It is a pure deduction puzzle — there are no timers and no randomness during play,
which makes it completely deterministic and a natural fit for test-first
development.

## The board

- A grid of `COLS × ROWS` cells (built-in puzzles are 10 × 10).
- Every cell is in one of three states:
  - `0` **empty** — undecided.
  - `1` **filled** — the player believes this cell is part of the picture.
  - `2` **marked** — the player has ruled this cell out (drawn an ✕). Marks are a
    memory aid only; they never count as filled.
- **Row clues** run down the left gutter, **column clues** across the top gutter.

## Clues

For any line (row or column) the clue is the list of run lengths of consecutive
filled cells, read left-to-right / top-to-bottom. A completely empty line has the
clue `[0]` (conventionally drawn as a single `0`).

```
lineClue([■ ■ □ ■])   -> [2, 1]
lineClue([□ □ □])      -> [0]
lineClue([■ ■ ■])      -> [3]
```

The clues shown to the player are derived once from the puzzle's hidden solution.

## Winning

The puzzle is **solved** when, considering only *filled* cells, every row's run
pattern matches its row clue **and** every column's run pattern matches its column
clue. This is the standard nonogram victory rule: marks are ignored, and a puzzle
with a unique solution is solved exactly when the filled cells reproduce the
picture.

A **mistakes** counter shows how many currently-filled cells are *not* part of the
solution. It is purely informational — a wrong fill never ends the game; the player
just can't win until every filled cell is correct and complete.

## Controls

- **Left click / tap** a cell → toggle it **filled**.
- **Right click** a cell → toggle it **marked** (✕).
- **Keyboard:** arrows / WASD move a cell cursor; `F` or `Space` toggles fill,
  `X` toggles a mark, `R` restarts the puzzle, `N` loads the next puzzle.

## Game phases (`window.game.state`)

- `ready` — the start overlay is showing.
- `playing` — the player is solving.
- `won` — every clue is satisfied.

## Testable API (on `window.game`)

- Geometry: `COLS`, `ROWS`, `CELL`, `ORIGIN_X`, `ORIGIN_Y`.
- State: `state`, `grid`, `solution`, `rowClues`, `colClues`, `puzzleIndex`.
- Pure helper: `lineClue(boolArray)` → run-length array (`[0]` when empty).
- Actions: `toggleFill(x, y)`, `toggleMark(x, y)`, `setCell(x, y, s)`,
  `isSolved()`, `mistakes()`, `reset()`, `loadPuzzle(rows)`, `loadBuiltin(i)`,
  `start()`.
- `window.PUZZLES` — the built-in puzzle list (`{ name, rows }`).

`loadPuzzle(rows)` takes an array of equal-length strings using `#` for a filled
cell and any other character for empty, computes the clues, and starts a fresh
empty grid — the deterministic entry point the tests use.

## Assumptions & simplifications

- **Win rule is clue-based**, not "filled cells equal the solution grid". For the
  hand-designed puzzles here (each with a unique solution) the two are equivalent,
  but clue-matching is the honest nonogram rule and is what the game checks.
- **Wrong fills are not punished** beyond the informational mistakes counter; there
  are no lives or time limits. This is the simpler, friendlier interpretation.
- **Marks are advisory** and ignored by the solver check.
- **Puzzles are fixed, hand-authored pictures** (no random generation), so every
  built-in puzzle is guaranteed solvable and its clues are derived directly from
  its solution.
