# Hitori

A canvas version of **Hitori**, the Nikoli logic puzzle (from the makers of
Sudoku). You are given a grid of numbers and must shade out cells until the
whole board obeys three simple rules at once.

## The rules

A puzzle is solved when **all three** are true:

1. **No number repeats in any row or column** among the white (un-shaded) cells.
2. **No two shaded (black) cells touch** side-to-side (diagonal is fine).
3. **All white cells are connected** into a single group (orthogonally).

## How to play

- **Click** a cell to shade it black. Click it again to clear it.
- Cells that currently break rule 1 (a duplicate white) or rule 2 (two blacks
  touching) are ringed in **red**, and the status line counts the conflicts.
- Solve the board and a **Solved!** banner appears.
- **Reset** clears your shading; **New Puzzle** moves to the next of the three
  built-in puzzles.

## Running

Open `index.html` directly in any browser — no build step or server needed.

Tests live in `tests/` and run with Playwright from the repo root:

```powershell
npx playwright test Hitori/tests/
```

See [DESIGN.md](DESIGN.md) for how the rule checks and puzzles are built.
