# Connect Four

The classic "drop and connect" game on a 7×6 grid, rendered on an HTML5 canvas.
You play **Red** against a computer-controlled **Yellow**. Line up four of your
discs in a row — horizontally, vertically, or diagonally — before your opponent
does.

## How to play

Open `index.html` in any browser — no build step or server required.

| Action              | Input                                     |
|---------------------|-------------------------------------------|
| Drop a disc         | Click a column                            |
| Drop into column 1–7| Number keys `1`–`7`                       |
| New game            | `R`, or the **New Game** button           |

A translucent "ghost" disc shows where your piece will land in the column under
your mouse. Red always moves first; Yellow (the computer) replies automatically.

## Rules

- Discs fall to the lowest empty slot in the chosen column.
- The first player to connect four in a row (any direction) wins — the winning
  four are highlighted.
- If the board fills with no four-in-a-row, it's a draw.
- A running match score (Red / Yellow / Draws) is kept below the board and saved
  to `localStorage`.

## The opponent

Yellow uses a deterministic one-ply strategy: it takes an immediate win if it has
one, otherwise blocks your immediate win, otherwise plays toward the centre (the
strongest area of the board). It never misses a win-or-block on the very next
move, so you have to think a turn ahead.

## Files

- `index.html` — page layout, HUD and scoreboard.
- `style.css` — presentation.
- `game.js` — all game logic (state, rules, AI, rendering).
- `DESIGN.md` — design notes and the testable architecture.
- `tests/connect-four.spec.js` — Playwright test suite.

See `DESIGN.md` for how the code is structured and why it's easy to test.
