# Sudoku — Design

## Concept

**Sudoku** is the classic 9×9 number-placement puzzle. The board is divided into
nine 3×3 boxes and seeded with some fixed **given** digits. The player fills the
empty cells so that every **row**, every **column**, and every **3×3 box**
contains each of the digits 1–9 exactly once. The puzzle is solved when the whole
board is filled with no rule violations.

This game joins the repo's logic-puzzle set (Minesweeper, Nonogram, Sokoban,
Lights Out, Flood It) but is mechanically its own: constraint satisfaction over a
9×9 grid with live conflict feedback, rather than mine-marking, line-clue
deduction, or crate-pushing.

## Mechanics

### Board

- A 9×9 grid (`N = 9`) rendered at `CELL = 56` px → a 504 × 504 canvas, with
  thicker rules every three cells to mark the 3×3 boxes.
- `board[r][c]` holds a digit `1–9`, or `0` for an empty cell.
- `given[r][c]` is `true` for the puzzle's fixed clues; those cells can never be
  edited.

### Puzzles

- Three difficulties — **easy**, **medium**, **hard** — each with a small bank of
  hand-verified puzzles. Every embedded puzzle was checked (with a backtracking
  solver) to be internally consistent and to have exactly **one** solution.
- **New Game** loads a random puzzle of the currently selected difficulty.

### Playing

- **Click** a cell (or move the selection with the **arrow keys**) to select it.
- Type **1–9** to place a digit in the selected non-given cell.
- **0**, **Backspace**, or **Delete** clears the selected cell.
- Given cells are locked and ignore input.
- A running **timer** shows elapsed time; on solve, the finish time is shown.

### Conflicts

- After every placement the board is scanned for **conflicts**: any cell whose
  digit is duplicated elsewhere in its row, column, or box. Conflicting cells are
  drawn in red so mistakes are visible immediately.
- The puzzle is **solved** when the board is completely filled **and** has no
  conflicts (which, for these unique-solution puzzles, means the one solution was
  reached). A win overlay is then shown with the elapsed time.

## Architecture

Plain HTML/CSS/JS, no build step, matching the other games. `index.html` holds
the canvas, HUD (difficulty · timer), and controls; `game.js` holds all logic and
rendering; `style.css` provides the dark look.

Logic is written as small functions over module-level globals so the Playwright
suite can drive and inspect the game via `page.evaluate` — the same testing seam
the other games use.

- **State globals**: `board`, `given`, `selected` (`{r, c}` or `null`), `state`
  (`'playing' | 'won'`), `difficulty`, `startTime`, `elapsed`.
- **Constants**: `N`, `CELL`, `PUZZLES` (the puzzle bank).
- **Functions**: `newGame(difficulty)`, `selectCell(r, c)`, `moveSelection(dr, dc)`,
  `enterDigit(n)`, `clearCell()`, `isGiven(r, c)`, `hasConflict(r, c)`,
  `findConflicts()` (array of `{r, c}`), `isComplete()`, `isSolved()`, `checkWin()`.

Rendering is redrawn on every change (the board is static between inputs, so no
animation loop is needed; a light `requestAnimationFrame` tick updates only the
timer text while playing).

## Assumptions

Chosen to keep the first version simple and unambiguous:

1. **Fixed puzzle bank, not a generator.** Generating a puzzle with a guaranteed
   unique solution is involved; a vetted bank of embedded puzzles is simpler and
   fully deterministic. Each was verified for validity and uniqueness offline.
2. **Solved = filled with no conflicts.** Because every embedded puzzle has a
   unique solution, "full board + zero conflicts" is equivalent to "correct",
   without needing to store the answer key.
3. **Live conflict highlighting is on.** This is an assist some purists disable,
   but it makes the game approachable and gives immediate feedback; it is kept
   simple (row/column/box duplicate check) and always on.
4. **No pencil marks / candidates.** A convenience feature omitted for the
   simpler first version; the HUD leaves room to add it later.
5. **No best-time persistence.** Solve time is shown on the win screen, but not
   saved, to avoid a timing-dependent feature in the first version.
6. **Difficulty is chosen via buttons**, defaulting to easy on load.
