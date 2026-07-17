# Flow — Design

## Game concept

**Flow** is a grid logic puzzle. Each level is a square grid dotted with pairs
of coloured endpoints. The player connects each pair with a **pipe** — a path of
orthogonally adjacent cells — subject to two rules:

1. Pipes may not cross or overlap each other.
2. Every cell of the grid must be filled.

A level is solved when every colour pair is connected *and* the whole board is
covered. It is a pure-logic puzzle: no timer, no randomness during play, and you
cannot lose — you simply keep re-routing pipes until the board is full.

This is a genre not otherwise present in the repo. It is distinct from:

- **Flood It** (recolour-the-board flood fill — no paths),
- **Pipe Mania / Pipe Dream** (place tiles against a flowing timer),
- **Sokoban / sliding puzzles** (move pieces, not draw connections).

## Board & levels

- The canvas is a fixed **480×480**. Each level declares a square `size`
  (5 or 6); the cell size is `480 / size`, so smaller boards render with larger
  cells.
- Levels are **authored**, not generated. Each is defined only by its colour
  endpoints, but every level was constructed from a full solution that tiles the
  entire grid, so each is guaranteed solvable with 100% coverage. (See the
  Assumptions section on why authored rather than generated.)
- Three levels ship: two 5×5 and one 6×6, increasing in size.

## Mechanics

- **Drawing** — press on an endpoint and drag through adjacent empty cells to
  the matching endpoint. Releasing ends the gesture. Each new gesture counts as
  one **move**.
- **Backtracking** — dragging back onto the pipe's previous cell erases the head,
  so you can retract without starting over.
- **Cutting** — dragging a pipe into a cell already used by another colour
  truncates that other pipe at the crossing point (the newcomer wins the cell).
  You may never route *through* another colour's endpoint, though.
- **Re-routing** — pressing on any cell that already belongs to a pipe resumes
  drawing that colour from that cell (trimming whatever came after it).
- **Solved** — when every pair is connected and every cell is filled, the level
  is complete; a "Level Solved" panel offers the next level (or "You Win!" after
  the last).

## Controls

| Input | Action |
|---|---|
| Mouse press + drag | Draw / re-route a pipe |
| Mouse release | Finish the gesture |
| R | Reset the current level |
| N / Enter | Next level (when the current one is solved) |
| Click / any key (on the intro) | Start |

## HUD

- **Level** — current level number.
- **Moves** — pipe-drawing gestures used on this level.
- **Pipe** — percentage of the board filled.
- **Best** — fewest moves you have ever solved this level in (persisted in
  `localStorage` under `flow-best-<level>`).

## Implementation notes

The game is a single classic (non-module) `game.js` script so its state
(`board`, `paths`, `state`, `moves`, `levelIndex`, …) and pure helper functions
(`startPath`, `extendPath`, `isConnected`, `filledCount`, `isSolved`,
`rebuildBoard`, `cellFromXY`, …) are reachable as globals from the Playwright
tests, mirroring the other games in this repo. Rendering is redraw-on-change
(the board only changes on input), and pipes are stroked as thick rounded lines
through cell centres with solid endpoint discs.

Core data structures:

- `ep[color] = [[r,c], [r,c]]` — the two endpoints of each colour (from the
  level).
- `paths[color] = [[r,c], …]` — the ordered pipe currently drawn for a colour,
  always beginning at the endpoint the player started from.
- `board[r][c]` — the colour owning each cell, rebuilt from `ep` + `paths` after
  every change so it is always consistent (no two pipes share a cell).

`isConnected(color)` is true when the pipe's two ends are exactly the colour's
two endpoints; `isSolved()` additionally requires `filledCount() === size²`.

## Assumptions

- **Authored, not generated levels**: guaranteeing a *randomly generated* Flow
  board is uniquely solvable (or solvable at all with full coverage) is a hard
  problem. The simpler, robust interpretation is to hand-author a few boards
  from known full-coverage solutions, so correctness is guaranteed. Three levels
  are enough to demonstrate the mechanic and give a difficulty ramp.
- **Cut-on-cross behaviour**: when a pipe is dragged over another colour's pipe,
  the older pipe is truncated (the standard Flow behaviour) rather than blocking
  the move; this keeps play fluid.
- **Move metric**: a "move" is one drawing gesture (press → drag → release),
  matching the reference game's counter closely enough; lower is better and the
  best is saved per level.
- **No lose state**: Flow has no failure condition, so there is no "game over"
  overlay — the completion overlay ("Level Solved" / "You Win!") takes its place.
- **Best score** is per-level fewest moves in `localStorage`, since a single
  global "score" does not fit a multi-level puzzle.
