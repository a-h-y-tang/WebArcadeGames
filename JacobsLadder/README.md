# Jacob's Ladder

*"He had a dream in which he saw a stairway resting on the earth, with its top
reaching to heaven, and the angels of God were ascending and descending on it."*
— Genesis 28:12

A race-to-100 board game on an HTML5 canvas, set under the starry sky of
Jacob's dream at Bethel. You (the blue token) race a computer opponent (red) up
a 10×10 board. Roll the die, climb the golden ladders, and dodge the serpents —
first to land *exactly* on square 100 wins.

## How to play

1. Press **Roll Die** (or **Space** / **Enter**) on your turn.
2. Your token advances by the die value. Land on the foot of a golden **ladder** to
   climb up; land on a **serpent's** head and slide down.
3. You must land *exactly* on square 100 — overshooting forfeits the turn.
4. The computer takes its turn automatically. First to 100 wins.

Your total wins are saved (shown as **Wins**) and persist between visits.

### Controls

| Input | Action |
|---|---|
| **Roll Die** button | Roll on your turn (or start / restart a game) |
| `Space` / `Enter` | Same as Roll Die |

### Board

The standard 100-square layout:

- **Ladders:** 1→38, 4→14, 9→31, 21→42, 28→84, 36→44, 51→67, 71→91, 80→100
- **Serpents:** 16→6, 47→26, 49→11, 56→53, 62→19, 64→60, 87→24, 93→73, 95→75,
  98→78

## Files

- `index.html` — page markup, HUD, and controls.
- `style.css` — board and layout styling.
- `game.js` — board maps, pure move logic (`applyJump`, `computeMove`),
  turn flow, and canvas rendering. See [DESIGN.md](DESIGN.md) for details.
- `tests/` — Playwright suite
  (`npx playwright test JacobsLadder/tests/`).
