# Reversi (Othello) — Design

## Game concept

A single-player implementation of the classic **Reversi** (also known as
**Othello**). The human plays **black**; the computer plays **white**. Players
alternate placing discs on an 8×8 board. Placing a disc so that it *flanks* one
or more of the opponent's discs in a straight line — with one of your own discs
at the far end — flips every flanked disc to your colour. When neither player can
move, the game ends and whoever has more discs wins.

Rendered entirely on an HTML5 `<canvas>`. No build step, no dependencies — open
`index.html` in a browser.

## Rules & mechanics

- **Board.** 8×8 grid. Each cell is empty, black, or white. Rendered at 60 px per
  cell (480×480 canvas).
- **Opening position.** The four centre cells start filled:
  `(3,3)` and `(4,4)` white; `(3,4)` and `(4,3)` black. **Black moves first.**
- **Legal move.** A cell is a legal move for a player if it is empty and,
  in at least one of the eight straight-line directions, there is a run of one or
  more opponent discs immediately adjacent that ends in one of the moving
  player's own discs. Placing there **flips** every disc in every such run.
- **Flipping.** All captured runs in all eight directions flip at once.
- **Passing.** If a player has no legal move but the opponent does, the turn
  passes back to the opponent (the game does not end).
- **Game over.** When neither player has a legal move (typically a full board),
  the game ends. The player with more discs wins; equal counts are a **draw**.
- **Move hints.** On the human's turn, legal cells are marked with a small
  translucent dot.

## AI opponent

The white AI is a deterministic one-ply heuristic:

1. Enumerate its legal moves.
2. Score each by a **positional weight table** (corners are highly valued,
   the cells diagonally/orthogonally adjacent to empty corners are penalised)
   plus the number of discs the move would flip.
3. Play the highest-scoring move, breaking ties by scan order (top-left first).

This makes the AI a meaningful but beatable opponent, and — crucially —
deterministic, so its behaviour can be asserted in tests.

## Controls

- **Left-click** an empty highlighted cell to place your (black) disc. The AI
  then responds automatically after a short pause. If you have no legal move your
  turn is passed automatically; if the AI has none, play returns to you.
- **`R` key** or the **New Game** button restarts.

## Rendering & state

All game logic lives in a top-level `game` object exposed on `window` for
deterministic testing, cleanly separated from rendering. Key surface:

- Cell constants: `EMPTY = 0`, `BLACK = 1`, `WHITE = 2`.
- `game.board[r][c]` — the 8×8 grid of cell values.
- `game.currentPlayer` — `BLACK` or `WHITE`.
- `game.state` — `'playing' | 'gameover'`.
- `game.winner` — `null | 'black' | 'white' | 'draw'` (set at game over).
- `game.legalMoves(player)` — array of `[r, c]` legal moves.
- `game.isLegalMove(r, c, player)` — boolean.
- `game.play(r, c)` — apply a move for the current player (flips + turn
  handling, including passes and game-over detection). Returns `true` if the
  move was legal and applied.
- `game.aiMove()` — have the white AI choose and play its best move.
- `game.scores()` — `{ black, white }` disc counts.
- `game.reset()` — restore the opening position, black to move.
- `game.setBoard(grid, currentPlayer)` — test hook to install an arbitrary
  position and whose turn it is (then normalises turn/game-over state).

## Assumptions

- **Single, self-contained page**, consistent with the other games in this repo:
  `index.html` + `game.js` + `style.css`, no server or bundler.
- **Human is black, AI is white, black moves first** — the standard Othello
  convention.
- **One AI difficulty.** A single positional heuristic is used rather than a
  configurable search depth; it is the simpler interpretation and keeps the AI
  deterministic for testing. Deeper minimax search was intentionally left out.
- **AI is deterministic** (no randomness) so tests can assert its moves. Tie-broken
  by scan order.
- **Turn/pass/game-over are derived from the board**, never tracked as a mutable
  flag that could drift out of sync.
- Where the rules were ambiguous, the standard Othello interpretation was chosen.
