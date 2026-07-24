# Hitori — Design

## Concept

**Hitori** ("alone" in Japanese) is a pencil-and-paper logic puzzle by Nikoli,
the publisher behind Sudoku. You start with a square grid full of numbers and
*shade out* (black) cells until the board obeys three rules simultaneously. It
is a pure deduction puzzle — no timing, no randomness, no opponent.

## Rules

A board is **solved** when all three hold at once:

1. **No duplicates in the light.** Among the un-shaded (white) cells, no number
   appears more than once in any single row or column.
2. **No touching shadows.** No two shaded (black) cells are orthogonally
   adjacent (diagonal touching is allowed).
3. **One connected sea.** Every white cell is reachable from every other white
   cell moving only up/down/left/right — the white cells form a single region.

## Mechanics & controls

| Input | Action |
|---|---|
| **Click** a cell | Toggle it black (shade); click again to clear it |
| **Reset** button | Clear all shading on the current puzzle |
| **New Puzzle** button | Advance to the next puzzle |

As you play, any cell currently breaking rule 1 (a duplicate white) or rule 2
(a touching pair of blacks) is ringed in red, and a status line reports how many
cells are in conflict. When the board satisfies every rule, a "Solved!" overlay
appears and the board locks until you reset or move on.

## Architecture

`game.js` is a single classic (non-module) script. All state (`grid`, `shade`,
`solved`, `puzzleIndex`) and — crucially — the **pure rule functions** live at
module scope so the Playwright suite can call them directly:

- `duplicateWhites(grid, shade)` → set of `"r,c"` keys violating rule 1
- `adjacentBlacks(shade)` → set of keys violating rule 2
- `whitesConnected(shade)` → boolean for rule 3 (flood fill)
- `isSolved(grid, shade)` → all three rules
- `violations(grid, shade)` → union of rule 1 & 2 offenders (for red rings)

Because these functions are side-effect free and deterministic, the entire
solver logic is unit-tested without touching the canvas or any timers.

### Puzzles

Three 5×5 puzzles ship in `PUZZLES`, each with its grid and a known
`solution` shading. Puzzle A was hand-built from a Latin square with a handful
of duplicate numbers introduced at the solution's black cells. Puzzles B and C
are derived from A by two rule-preserving transforms — **transposition** and a
**symbol relabelling (bijection)** — both of which keep a valid Hitori board
valid, so the same solution mask applies. The test suite verifies every shipped
solution against the rule functions.

## Assumptions

- **Hand-crafted puzzles** rather than a runtime generator, chosen as the
  simpler interpretation. Puzzle A is designed to have its intended solution;
  as with many small casual Hitori boards it is not *proven* to be the unique
  solution, and any shading that satisfies all three rules is accepted as a win.
- **Left-click cycles white ↔ black only.** Real Hitori players sometimes also
  "circle" cells they have deduced must stay white; that marking aid is omitted
  as non-essential and the simpler choice.
- A **5×5 grid** keeps the puzzle approachable and the cells comfortably
  clickable; the code is size-agnostic (`N` is read from the grid).
