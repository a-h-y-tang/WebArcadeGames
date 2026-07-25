# Mahjong Solitaire

The classic tile-matching solitaire. Clear a stacked, pyramid-shaped board by
removing **free** pairs of identical tiles. A tile is *free* when nothing sits on
top of it and at least one of its left/right sides is open. **Every deal is
guaranteed solvable.**

## How to play

- **Click** a free tile to select it, then **click a matching free tile** to
  remove the pair. Clicking the selected tile again deselects it. Clicking a
  blocked tile does nothing.
- Match all 64 tiles (16 faces, four of each) to win.
- **Hint (H)** — briefly highlight a matchable pair.
- **Undo (U)** — take back the last removed pair (unlimited, and it lifts you out
  of a dead end).
- **New Game (N)** — deal a fresh solvable board.

Your fastest solve time is saved in the browser.

## Playing

Open `index.html` directly in any browser — no build step or server required.

## Design

See [DESIGN.md](DESIGN.md) for the layout, the free-tile rule, and the
solvable-deal generator.

## Tests

Playwright tests live in `tests/`. From the repo root:

```powershell
npx playwright test MahjongSolitaire/tests/
```
