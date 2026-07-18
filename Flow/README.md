# Flow

Connect every pair of coloured dots with a pipe — and fill the whole board.

Flow (also known as *Numberlink* or *Flow Free*) is a grid logic puzzle. Each grid
holds pairs of coloured dots. Draw a pipe between each pair so that pipes never
cross and **every cell is covered**. A puzzle is solved only when all pairs are
connected and the board is completely filled.

## How to play

- **Drag** from a coloured dot through adjacent cells to lay its pipe, and release
  on the matching dot to complete the connection.
- Grab a dot (or any point along an existing pipe) to redraw from there.
- Drag **back** onto the previous cell to shorten a pipe.
- Drag a pipe **through** another colour's pipe to overwrite it — the newest pipe
  wins and the crossed pipe's tail is erased.
- A pipe can't pass through another colour's dot or loop back on itself.

### Controls

| Input | Action |
|---|---|
| Mouse / touch drag | Draw and connect pipes |
| **R** | Restart the current level |
| **N** | Advance to the next level |
| Level buttons (5×5 / 6×6 / 7×7) | Jump to a level |

## Scoring

The HUD tracks how many flows are connected and how many moves you've made. Solving
a level in **fewer moves** is better; your best move count per level is saved in
your browser's `localStorage`.

## Levels

Three hand-crafted, fully-fillable puzzles of increasing size: 5×5, 6×6 and 7×7.

## Running

Open `index.html` directly in a browser — no build step or server required.

Tests live in `tests/flow.spec.js` and run with Playwright:

```powershell
npx playwright test Flow/tests/
```

See [DESIGN.md](DESIGN.md) for the mechanics, exposed API, and design assumptions.
