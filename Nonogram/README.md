# Nonogram (Picross)

A picture-logic puzzle. Use the number clues along each row and column to work out
which cells are filled, and reveal the hidden picture.

## How to play

Each **row clue** and **column clue** lists the lengths, in order, of the runs of
filled cells in that line. For example a clue of `4 2` means: somewhere in the line
there are four filled cells in a row, then (after at least one gap) two more in a
row — in that order.

1. Press **Start**.
2. **Left-click** a cell to fill it (you think it's part of the picture).
3. **Right-click** a cell to mark it with an ✕ (you've ruled it out). Marks are
   just a memory aid — they don't affect winning.
4. Deduce the whole picture. You win when every row and column matches its clue.

The **Mistakes** counter shows how many currently-filled cells are wrong — a handy
hint that you've mis-deduced somewhere. Nothing punishes a mistake; you simply
can't win until every filled cell is correct.

## Controls

| Action | Input |
|---|---|
| Fill a cell | Left-click, or **F** / **Space** on the cursor |
| Mark a cell (✕) | Right-click, or **X** on the cursor |
| Move the cursor | **Arrow keys** / **WASD** |
| Reset the puzzle | **R** or the Reset button |
| Next puzzle | **N** or the Next button |

## Files

- `index.html` — page shell, canvas, HUD and overlay.
- `style.css` — presentation.
- `game.js` — clue derivation, the solver check, rendering and input. See
  [`DESIGN.md`](DESIGN.md) for the rules and the `window.game` API used by tests.
- `tests/nonogram.spec.js` — Playwright test suite.

## Running the tests

From the repository root:

```powershell
npx playwright test Nonogram/tests/
```
