# Match-3

A *Bejeweled*-style gem-swapping puzzle on an 8×8 board. Swap adjacent gems to
line up three or more of the same colour; matched gems clear, the board drops to
fill the gaps, and chain-reaction **cascades** rack up bonus points. You get
**20 moves** — score as high as you can before they run out.

## How to play

- **Click a gem**, then **click an adjacent gem** to swap them.
- A swap is only accepted if it creates a line of **3 or more** matching gems
  (horizontally or vertically). An illegal swap snaps back and costs nothing.
- Cleared gems fall away; gems above drop down and new ones fill in from the top.
  Fresh line-ups clear too — those **cascades** score a rising multiplier.
- The game ends when you run out of moves. Your best score is saved locally.

## Controls

| Action | Input |
|---|---|
| Select / swap gems | Mouse click (or tap) |
| Start / restart | **Space**, **Enter**, or the **Start** button |

## Scoring

Each cleared gem is worth **10 points × the cascade step**: the swap's own clear
scores ×1, the cascade it triggers scores ×2, the next ×3, and so on. Long
chains are worth far more than the same gems cleared one match at a time.

## Running the tests

From the repo root:

```powershell
npx playwright test Match3/tests/
```

## Files

- `index.html` — page markup, HUD and overlay.
- `style.css` — layout and gem/board styling.
- `game.js` — all game logic and rendering (exposed as top-level functions so
  the Playwright suite can drive it deterministically).
- `DESIGN.md` — design notes: concept, mechanics, and assumptions.
