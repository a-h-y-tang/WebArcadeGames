# Checkers — Design

## Concept

Classic **Checkers (Draughts)** on an HTML5 canvas. The human plays the **red**
pieces against a computer opponent playing **black**, on the standard 8×8 board
using the 32 dark squares. Slide your pieces diagonally, jump the opponent to
capture, reach the far row to crown a **king**, and win by capturing or
immobilising all of the opponent's pieces.

This implementation follows the common **American / English draughts** rules:

- Men move diagonally **forward** one square; kings move diagonally forward or
  backward.
- Captures are made by jumping diagonally over an adjacent enemy piece into the
  empty square beyond.
- **Captures are mandatory**: if any capture is available, the player must make a
  capturing move.
- **Multi-jumps**: after a jump, if the same piece can jump again it must
  continue jumping until no further capture is possible.
- A man reaching the opponent's back row becomes a king (and, per common rules,
  the turn ends there even if more jumps would otherwise be possible).

## Board model

- `board[row][col]`, row `0` at the **top**, row `7` at the **bottom**.
- Only dark squares (`(row + col) % 2 === 1`) are playable.
- Cell values:
  - `0` = empty
  - `1` = red man, `3` = red king (human)
  - `2` = black man, `4` = black king (AI)
- The human (red) starts on the bottom three rows and moves **upward** (toward
  row 0); black starts on the top three rows and moves **downward**.

## Mechanics

- **Move generation** derives all legal moves for the side to move. If any
  capture exists, only captures are returned (mandatory capture). Multi-jump
  sequences are expanded so each legal move is a full jump chain.
- **Applying a move** slides the piece, removes any jumped pieces, and promotes
  to king on reaching the back row.
- **Turn switching** happens after a completed move (a full multi-jump counts as
  one turn).
- **Win / loss / draw**: a side with no pieces or no legal moves loses. The game
  ends when the side to move has no legal moves.
- **AI**: a depth-limited **minimax with alpha-beta pruning** (default depth 6
  plies). The evaluation counts material (kings worth more than men), rewards
  advancement toward promotion and central/back-row safety. It is
  **deterministic** — no randomness, ties broken by move order — so tests are
  reproducible.

## Controls

- **Mouse**: click one of your pieces to select it (its legal destinations are
  highlighted), then click a highlighted square to move. Clicking another of
  your pieces re-selects; clicking elsewhere deselects.
- **R**: restart the game.
- **Button**: the overlay button starts / restarts the game.

## State machine

- `ready` — start overlay visible, awaiting the first input.
- `playing` — human to move (red).
- `thinking` — the AI is computing/applying its move; human input ignored.
- `over` — game finished; overlay shows the result.

Exposed globals for testing: `board`, `currentPlayer`, `state`, `selected`,
`ROWS`, `COLS`, and functions `getMoves(player)`, `getPieceMoves(r, c)`,
`applyMove(move)`, `hasAnyCapture(player)`, `isKing(v)`, `ownerOf(v)`,
`countPieces(player)`, `bestMove(player)`, `selectPiece(r, c)`,
`clickSquare(r, c)`, `startGame()`, and `restart()`.

## Assumptions

- The repo already contains puzzle/board titles (Minesweeper, 2048, Sokoban,
  Reversi is a sibling on another branch), so a draughts board game fits the
  arcade collection; "arcade" is read broadly.
- American/English draughts rules are used (men capture forward only; flying
  kings are **not** used — kings move a single square). This is the simplest
  widely-recognised ruleset; international draughts variants are out of scope.
- Mandatory capture is enforced, matching standard tournament rules and giving
  the AI and tests unambiguous move sets.
- The human always plays red and moves first; a single fixed AI depth is used
  rather than a difficulty selector, keeping the UI and tests simple.
- The AI is fully deterministic (no `Math.random`) so Playwright tests observe
  stable behaviour.
- A move is represented as `{ from: [r, c], to: [r, c], captures: [[r,c],...] }`;
  multi-jumps carry every captured square in `captures` and the final landing
  square in `to`.
- Canvas is a fixed 560×560 board (70 px per square), scaled down responsively
  by CSS on small screens.
