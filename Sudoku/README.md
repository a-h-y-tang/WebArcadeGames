# Sudoku

The classic 9×9 number-placement puzzle. Fill every empty cell so that each row,
each column, and each 3×3 box contains the digits 1–9 exactly once. Mistakes are
highlighted in red as you go, and the board celebrates when you solve it.

## How to play

- **Click** a cell (or use the **arrow keys**) to select it.
- Type **1–9** to place a digit; **0**, **Backspace**, or **Delete** clears it.
- Fixed clue cells are locked and can't be changed.
- Duplicate digits in a row, column, or box are shown in **red**.
- Solve the whole grid with no conflicts to win — your time is shown on the
  finish screen.

Use **New Game** to load another puzzle, and **Easy / Medium / Hard** to pick a
difficulty. Every puzzle has exactly one solution.

## Files

- `index.html` — page markup, canvas, HUD, and controls
- `style.css` — dark styling
- `game.js` — all game logic and rendering (the puzzle bank is embedded)
- `DESIGN.md` — concept, mechanics, architecture, and assumptions
- `tests/sudoku.spec.js` — Playwright test suite

## Running the tests

From the repo root:

```powershell
npx playwright test Sudoku/tests/
```
