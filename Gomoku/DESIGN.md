# Gomoku (Five in a Row) — Design

## Concept

Gomoku is the classic two-player abstract strategy game played on the
intersections of a **15 × 15** Go-style board. You play **Black** and move
first; the computer plays **White**. Players alternate placing a stone on any
empty intersection. The first to line up **five of their stones in an unbroken
row** — horizontally, vertically, or diagonally — wins. If the board fills with
no such line, the game is a draw.

This build is single-player: a human (Black) against a deterministic heuristic
AI (White).

## Mechanics

- **Board.** A `BOARD_SIZE × BOARD_SIZE` grid (15 × 15 = 225 intersections),
  stored as `board[row][col]` with `0` = empty, `1` = Black, `2` = White.
- **Turns.** Black moves first. `placeStone(r, c)` places a stone for the
  current player on an empty, in-bounds intersection, then either ends the game
  (win/draw) or passes the turn. Placing on an occupied or out-of-bounds cell is
  rejected and changes nothing.
- **Win detection.** After a stone is placed at `(r, c)` for player *p*, the
  four axes (horizontal, vertical, and both diagonals) are scanned outward from
  `(r, c)` in both directions. Five or more contiguous *p* stones is a win. Only
  the just-placed stone is examined — the rest of the board can't have changed.
- **Draw.** When all 225 intersections are filled with no winner, the game ends
  in a draw (`winner === 0`).
- **The AI (White).** On its turn the AI scores every empty cell and plays the
  highest-scoring one (ties broken by scan order, so it is fully deterministic):
  1. If it can complete five-in-a-row, it plays that winning cell.
  2. Otherwise, if the opponent has a line that would make five next turn, it
     blocks it.
  3. Otherwise it maximises a positional score — the length and openness of the
     runs the move creates for White minus the threat it leaves for Black,
     nudged toward the centre.
- **Wins counter.** The number of games the human has won is persisted to
  `localStorage` under `gomoku.wins` and shown in the HUD (the repo's
  "best score" convention, adapted to a turn-based game).

## Controls

- **Click** an empty intersection to place your (Black) stone. The AI replies
  automatically after a brief pause.
- **Enter / Space**, or the **Start / Play Again** button, begins or restarts a
  game.
- The board snaps your click to the nearest intersection within half a cell.

## State exposed for tests

Following the repo convention, state lives in the page's global scope so the
Playwright suite can drive and inspect it directly:

- `state` — `'idle' | 'playing' | 'over'`
- `board` — `board[r][c] ∈ {0, 1, 2}`
- `currentPlayer` — `1` (Black / human) or `2` (White / AI)
- `winner` — `0` (none/draw), `1` (Black), `2` (White)
- `moveCount`, `wins`
- `BOARD_SIZE` (15)
- `placeStone(r, c)` — pure move logic (no AI side-effect); returns `true` on a
  legal move
- `checkWin(r, c, player)` — five-in-a-row test around `(r, c)`
- `aiMove()` — have White choose and play a move
- `startGame()` — begin / restart

`placeStone` deliberately does **not** trigger the AI, so tests can drive both
colours directly; in normal play a canvas click places Black and then schedules
`aiMove()`.

## Assumptions

- **Standard (free-style) Gomoku.** No opening restrictions, no "exactly five"
  rule, no swap/renju handicaps. Five *or more* in a row wins. Simpler
  interpretation, per the task guidance; noted here.
- **Human is Black and moves first**; the AI is White. Fixed, not selectable.
- **Deterministic AI.** The opponent uses a fixed heuristic with scan-order
  tie-breaking (no randomness) so behaviour is reproducible for tests. It is a
  competent blocker/finisher, not a deep search — it looks one move ahead for
  wins and immediate threats.
- **No pause.** A turn-based board game has no real-time loop to pause, so P is
  omitted (unlike the action games in this repo).
- **Canvas size** is fixed at 540 × 540 (15 intersections at a 34 px pitch with
  a 32 px margin); no responsive scaling, matching the other games here.
