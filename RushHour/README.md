# Rush Hour

The classic sliding-block traffic-jam puzzle. A 6×6 grid is packed with cars
and trucks that can only slide **along their own orientation**. Clear a path and
slide the **red car** off the right edge of the board through the exit — in as
few moves as possible.

## Playing

Open `index.html` in any browser — no build step or server required.

### Controls

| Input | Action |
|---|---|
| **Click / tap** a vehicle | Select it (it highlights) |
| **Click** an empty cell in line with the selected vehicle | Slide it as far as it can go toward that cell |
| **↑ / ↓ / ← / →** | Nudge the selected vehicle one cell along its axis |
| **R** | Restart the current level |
| **N** | Skip to the next level |
| Any key / **Start** button | Begin from the title or solved screen |

Horizontal vehicles move only left/right; vertical vehicles move only up/down.
No two vehicles may overlap. You win a level when the red car reaches the exit
on the right wall.

## Scoring

- **MOVES** — moves made on the current level (one vehicle slide = one move).
- **LEVEL** — which puzzle you're on.
- **BEST** — the fewest moves you've ever solved a level in, saved in your
  browser.

## How it works

Levels are hand-authored as readable 6×6 text grids and parsed into vehicle
objects; all the rules are pure functions over that list. Every bundled level
is **guaranteed solvable** — a breadth-first solver in the test suite proves
each one is solvable and not already solved. See [DESIGN.md](DESIGN.md) for the
board model, move rules, and assumptions.

## Tests

Playwright tests live in `tests/`. From the repository root:

```powershell
npx playwright test RushHour/tests/
```
