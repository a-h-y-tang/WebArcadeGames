# Ultimate Tic-Tac-Toe

**Ultimate Tic-Tac-Toe** is the strategic big-brother of noughts-and-crosses,
rendered on an HTML5 canvas. The board is a **3×3 grid of 3×3 boards** (81 cells).
You play **X** against a computer-controlled **O**. To win, you must win **three
mini-boards in a row** on the big board.

The twist: **the cell you play decides which mini-board your opponent must play
in next.** Every move is both an attack and a choice of where to send your rival.

## How to play

Open `index.html` in any browser — no build step or server required.

| Action        | Input                              |
|---------------|------------------------------------|
| Place a mark  | Click a highlighted (legal) cell   |
| New game      | `R`, or the **New Game** button    |

X (you) always moves first; O (the computer) replies automatically.

## Rules

- Your first move may be in **any** board.
- When you play the cell at position *k* inside a mini-board, your opponent must
  play their next move in **mini-board *k***. The board you must play in is
  highlighted.
- If you are sent to a mini-board that is already **decided** (won or full), you
  get a **free choice** of any open board instead.
- Win a mini-board by getting three of your marks in a line (row, column, or
  diagonal). That mini-board is then claimed and stamped in your colour.
- Win the **game** by claiming three mini-boards in a line on the big board — the
  winning line is highlighted.
- A mini-board that fills up with no winner is a **draw** and counts for neither
  side. If every mini-board is decided with no macro line, the whole game is a
  draw.
- A running match score (X / Draws / O) is shown below the board and saved to
  `localStorage`.

## The opponent

O plays a deterministic strategy — no randomness, so it behaves the same every
time:

1. **Win now** — if O can complete three mini-boards in a row, it does.
2. **Win a mini-board** — otherwise it prefers a move that claims a mini-board,
   weighing the centre and corners more.
3. **Play safe** — it avoids sending you to a board where you could immediately
   win a mini-board (and never to one where you could win the game), and biases
   toward strong cells and boards.

It always takes an immediate game win and never plays an illegal move, so you
have to out-plan it a move ahead — set up two threats at once and it can't stop
both.

## Files

- `index.html` — page layout, HUD and scoreboard.
- `style.css` — presentation.
- `game.js` — all game logic and rendering.
- `tests/ultimate-tic-tac-toe.spec.js` — Playwright test suite.
- `DESIGN.md` — how the code works and the design decisions behind it.
