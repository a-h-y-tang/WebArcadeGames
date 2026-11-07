# Fruit of the Spirit

*"But the fruit of the Spirit is love, joy, peace, forbearance, kindness,
goodness, faithfulness, gentleness and self-control."* — Galatians 5:22-23

A fruit-swapping puzzle on an 8×8 board. Swap adjacent fruit to line up three or
more of the same kind; matched fruit is gathered in, the board drops to fill the
gaps, and chain-reaction **cascades** rack up bonus points. You get **20 moves**
— score as high as you can before they run out.

## How to play

- **Click a fruit**, then **click an adjacent fruit** to swap them.
- A swap is only accepted if it creates a line of **3 or more** matching fruit
  (horizontally or vertically). An illegal swap snaps back and costs nothing.
- Cleared fruit fall away; fruit above drop down and new ones fill in from the top.
  Fresh line-ups clear too — those **cascades** score a rising multiplier.
- The game ends when you run out of moves. Your best score is saved locally.

## Controls

| Action | Input |
|---|---|
| Select / swap fruit | Mouse click (or tap) |
| Start / restart | **Space**, **Enter**, or the **Start** button |

## Scoring

Each cleared fruit is worth **10 points × the cascade step**: the swap's own clear
scores ×1, the cascade it triggers scores ×2, the next ×3, and so on. Long
chains are worth far more than the same fruit cleared one match at a time.

## Running the tests

From the repo root:

```powershell
npx playwright test FruitOfTheSpirit/tests/
```

## Files

- `index.html` — page markup, HUD and overlay.
- `style.css` — layout and fruit/board styling.
- `game.js` — all game logic and rendering (exposed as top-level functions so
  the Playwright suite can drive it deterministically).
- `DESIGN.md` — design notes: concept, mechanics, and assumptions.
