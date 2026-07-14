# 2048

The sliding-tile puzzle. Slide the whole 4×4 board in any direction; when two
tiles of the same number touch they merge into one worth double. A new tile
appears after every move. Combine your way up to the **2048** tile — then keep
going for a higher score. The game ends when the board is full with no merges left.

## Play

Open `index.html` directly in a browser — no build step or server required.

## Controls

| Key | Action |
|---|---|
| ← / A | Slide left |
| → / D | Slide right |
| ↑ / W | Slide up |
| ↓ / S | Slide down |

Press any of these keys (or the **Start Game** button) to begin. After a game
over, the same keys start a new game.

## Scoring

- Every merge adds the value of the new tile to your score.
- Reaching a 2048 tile shows a win banner; press any key to keep playing.
- Your best score is saved in the browser (`localStorage`).

## How it works

See [DESIGN.md](DESIGN.md) for the full design: the grid model, the pure
`collapse` sliding/merging rule that all four moves reduce to, tile spawning, and
win / game-over detection.

## Tests

Playwright tests live in `tests/2048.spec.js`. From the repo root:

```powershell
npx playwright test 2048/tests/
```
