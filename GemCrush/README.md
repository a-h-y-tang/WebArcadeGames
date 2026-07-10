# Gem Crush

A match-3 puzzle game rendered on an HTML5 canvas. Swap adjacent gems to line
up three or more of the same colour, trigger cascading chains, and rack up
points until the board runs out of moves.

## How to play

1. Click **Start Game** (or press any key).
2. **Click a gem** to select it — it gets a white highlight.
3. **Click an orthogonally adjacent gem** to swap the two.
   - If the swap lines up **three or more** matching gems in a row or column,
     they clear, everything above falls down, and new gems drop in from the top.
   - If the swap makes no match, it snaps back.
4. Clearing gems that fall into new matches triggers a **cascade** — each chained
   clear in a single move is worth progressively more points.
5. The game ends when the board is **deadlocked**: no possible swap can make a
   match. Your best score is saved between sessions.

## Controls

| Action | Input |
|---|---|
| Select a gem | Click it |
| Swap | Click an adjacent gem |
| Deselect | Click the selected gem again |
| Start / restart | Start button, or any key |

## Scoring

Each cleared gem is worth `10 × cascade level`. The first clear from a swap is
level 1; every chained clear it sets off counts one level higher, so long combo
chains are rewarded heavily.

## Gems

Six gem types, each a distinct colour **and** shape (circle, diamond, square,
triangle, hexagon, star) so the board reads clearly without relying on colour
alone.

## Files

- `index.html` — page structure, canvas, HUD, and overlay.
- `style.css` — dark arcade theme.
- `game.js` — all game logic and rendering.
- `DESIGN.md` — design notes, mechanics, and assumptions.
- `tests/` — Playwright test suite.

See [`DESIGN.md`](DESIGN.md) for a full breakdown of the code and mechanics.

## Running the tests

From the repository root:

```powershell
npx playwright test GemCrush/tests/
```
