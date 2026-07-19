# Snakes and Ladders

The classic race-to-100 board game on an HTML5 canvas. You (the blue token)
race a computer opponent (red) up a 10×10 board. Roll the die, climb the
ladders, and dodge the snakes — first to land *exactly* on square 100 wins.

## How to play

1. Press **Roll Die** (or **Space** / **Enter**) on your turn.
2. Your token advances by the die value. Land on a **ladder** foot to climb
   up; land on a **snake** head and slide down.
3. You must land *exactly* on square 100 — overshooting forfeits the turn.
4. The computer takes its turn automatically. First to 100 wins.

Your total wins are saved (shown as **Wins**) and persist between visits.

### Controls

| Input | Action |
|---|---|
| **Roll Die** button | Roll on your turn (or start / restart a game) |
| `Space` / `Enter` | Same as Roll Die |

### Board

Standard Milton-Bradley layout:

- **Ladders:** 1→38, 4→14, 9→31, 21→42, 28→84, 36→44, 51→67, 71→91, 80→100
- **Snakes:** 16→6, 47→26, 49→11, 56→53, 62→19, 64→60, 87→24, 93→73, 95→75,
  98→78

## Files

- `index.html` — page markup, HUD, and controls.
- `style.css` — board and layout styling.
- `game.js` — board maps, pure move logic (`applyJump`, `computeMove`),
  turn flow, and canvas rendering. See [DESIGN.md](DESIGN.md) for details.
- `tests/` — Playwright suite
  (`npx playwright test SnakesAndLadders/tests/`).
