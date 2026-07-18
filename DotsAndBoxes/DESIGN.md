# Dots and Boxes — Design

## Game concept

Dots and Boxes is a classic pencil-and-paper strategy game. On a grid of dots,
players take turns drawing a single horizontal or vertical line between two
adjacent dots. Whenever a player draws the line that **completes the fourth
side of a box**, they claim that box **and take another turn**. When every box
has been claimed, the player who owns the most boxes wins.

In this implementation the human plays **Blue** and a deterministic **computer**
opponent plays **Red**, on a **4×4 box** grid (5×5 dots, 16 boxes). Blue moves
first.

## Mechanics

- **Grid.** `SIZE = 4` boxes per side. Dots sit at grid intersections
  (`SIZE + 1` per row/column). Two edge arrays track drawn lines:
  - `hEdges[r][c]` — horizontal edges, `r` in `0..SIZE`, `c` in `0..SIZE-1`.
  - `vEdges[r][c]` — vertical edges, `r` in `0..SIZE-1`, `c` in `0..SIZE`.
  Each edge is `0` (not drawn), `1` (blue), or `2` (red) — the owner is stored
  only for coloring; it does not affect scoring.
- **Boxes.** `boxes[r][c]` (`r,c` in `0..SIZE-1`) is `0` (unclaimed), `1`, or
  `2`. A box's four sides are `hEdges[r][c]` (top), `hEdges[r+1][c]` (bottom),
  `vEdges[r][c]` (left), and `vEdges[r][c+1]` (right).
- **Drawing a line.** `drawEdge(type, r, c)` draws one undrawn edge for the
  current player and returns the number of boxes that move **completed**
  (`0`, `1`, or `2`; `-1` for an illegal move). Completed boxes are claimed by
  the current player and increment their score.
- **Extra turn.** Completing at least one box keeps the turn with the current
  player; completing none passes the turn to the opponent. This is the heart of
  the game — chaining completed boxes lets a player run out long corridors.
- **Game over.** When all 16 boxes are claimed the game ends. The winner is
  whoever holds more boxes; equal counts are a draw.
- **Computer opponent (deterministic).** After the human's turn ends, the
  computer plays — possibly several lines in a row while it keeps completing
  boxes. Its move is chosen by a fixed, reproducible heuristic (no randomness),
  scanning edges in a fixed order (all horizontals row-major, then all
  verticals):
  1. **Take a box:** play the first edge that completes a box.
  2. **Play safe:** otherwise play the first edge that does **not** give a box
     its third side (which would hand the human a free box next turn).
  3. **Give the least:** if every remaining edge is unsafe, play the first
     available edge.
  Determinism keeps games reproducible and the tests reliable.

## Controls

- **Mouse:** move the pointer near an edge slot to highlight the line that would
  be drawn; **click** to draw it. Clicks snap to the nearest undrawn edge.
- **New Game:** the on-screen button starts a fresh game.

While the computer is taking its turn, human clicks are ignored.

## State exposed for testing

Core state and helpers are page-level globals so the Playwright suite can drive
and inspect the game via `page.evaluate`:

- `SIZE` — boxes per side (4).
- `hEdges`, `vEdges` — the edge-ownership arrays.
- `boxes` — claimed-box ownership.
- `currentPlayer` — `1` (blue / human) or `2` (red / computer).
- `state` — `'idle' | 'playing' | 'over'`.
- `scores` — `{ 1: blueCount, 2: redCount }`.
- `winner` — `0` (none / draw), `1`, or `2`.
- Functions: `startGame()`, `drawEdge(type, r, c)`, `edgeDrawn(type, r, c)`,
  `sidesOfBox(r, c)`, `isBoardFull()`, `chooseAiMove()`, `availableEdges()`.

`drawEdge` performs exactly one atomic move and does **not** auto-trigger the
computer, so tests can construct positions deterministically. The full
human-vs-computer flow (including the computer chaining moves) is exercised
through simulated clicks.

## Assumptions

- **Human is Blue and moves first.** Simplest framing; no color/turn picker.
- **Single deterministic opponent.** One reproducible greedy-but-safe heuristic
  rather than a difficulty selector — the simpler interpretation of "computer
  opponent," and it keeps tests stable. The AI looks one move ahead (take a box
  / avoid giving one) but does not solve endgame chains optimally.
- **No randomness anywhere.** Guarantees reproducible games and stable tests.
- **Fixed 4×4 grid.** Big enough for real strategy, small enough to finish
  quickly and render cleanly. (`SIZE` is a single constant if a different size
  is ever wanted.)
- **Owner stored per edge only for color.** Scoring depends solely on completed
  boxes, per the standard rules.
- **Mouse-driven input.** Drawing a specific edge maps naturally to clicking
  near it; there is no keyboard edge-selector (kept minimal).
