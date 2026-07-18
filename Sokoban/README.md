# Sokoban

Push every crate onto a goal square to clear the level. Crates can only be
pushed — never pulled — and only one at a time, so think before you shove one
into a corner. A classic warehouse puzzle rendered on an HTML5 canvas.

## How to play

1. Open `index.html` in a browser (no server or build step needed).
2. Press **Start Game** (or any movement key) to begin at level 1.
3. Walk into a crate to push it. Get all crates onto the yellow goal dots.
4. Clear a level to advance; clear the last level to win.

### Controls

| Input                    | Action                |
|--------------------------|-----------------------|
| Arrow keys / **W A S D** | Move / push           |
| **U** or **Z**           | Undo last move        |
| **R**                    | Restart current level |
| **N**                    | Next level            |
| On-screen buttons        | Undo · Reset · Next   |

Counters track your **moves** and **pushes** for the current level, and the
fewest-moves **best** for each level is saved in your browser.

## Levels

Six hand-made levels of increasing difficulty are bundled in `game.js`. Every
one has been verified solvable.

## Development

See [`design.md`](design.md) for the internal design. Tests live in
[`tests/sokoban.spec.js`](tests/sokoban.spec.js) and run with the repo's
Playwright setup:

```powershell
npx playwright test Sokoban/tests/
```
