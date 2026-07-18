# Flow — Design

## Concept

**Flow** (a.k.a. *Numberlink* / *Flow Free*) is a logic puzzle played on a square
grid. The grid contains pairs of coloured dots. The goal is to connect every pair
with a pipe so that:

1. Each pipe joins the two dots of the same colour.
2. Pipes never cross or overlap.
3. **Every cell of the grid is filled** (the classic "flow" win condition).

A puzzle is solved only when all colour pairs are connected *and* the whole board
is covered.

## Mechanics

- The board is a `SIZE × SIZE` grid. Each level defines a set of colour endpoints.
- A **pipe** for a colour is an ordered chain of orthogonally-adjacent cells that
  starts at one endpoint of that colour.
- The player drags out from an endpoint (or from anywhere along an existing pipe)
  to extend that colour's pipe cell by cell.
- **Backtracking:** dragging back onto the previous cell shortens the pipe.
- **Overwriting:** dragging a pipe into a cell already owned by *another* colour
  truncates that other colour's pipe at the point of intersection (its tail is
  erased). This is the standard Flow behaviour — the newest pipe wins.
- **Blocked moves:** a pipe cannot pass through *another* colour's endpoint dot,
  and cannot loop back onto its own body.
- Reaching the matching endpoint **completes** that colour's flow.

### Win / scoring

- The HUD tracks *flows connected* (`connected / total`) and a *move* counter
  (one move per drag interaction).
- A puzzle is **won** when `isSolved()` is true: every colour connected and every
  cell filled.
- The best (fewest) move count per level is persisted in `localStorage`
  (`flow-best-<level>`), lower being better.

## Controls

- **Mouse / touch:** press on a dot (or pipe), drag through adjacent cells, release.
- **R:** restart the current level.
- **N:** advance to the next level.
- **Level buttons:** jump directly to a level.
- **Start button / overlay:** begins the current level.

## Levels

Levels are hand-crafted, fully-fillable puzzles of increasing size:

| Level | Grid | Colours |
|---|---|---|
| 1 | 5×5 | 5 |
| 2 | 6×6 | 6 |
| 3 | 7×7 | 7 |

Each level is built from a known full-cover tiling (one colour snakes along the top
row and right column; the remaining colours fill the interior rows), which
guarantees a valid solution that fills the whole board.

## Code structure

`game.js` exposes a small, side-effect-light API on the global scope so the
Playwright suite can drive the game deterministically:

- State: `SIZE`, `state` (`'ready' | 'running' | 'won'`), `level`, `cellColor`
  (2-D colour grid, `-1` = empty), `endpointColor` (2-D, `-1` = not an endpoint),
  `paths` (colour → ordered cell list), `moves`, `LEVELS`.
- Actions: `startGame(level)`, `beginPath(r, c)`, `extendPath(r, c)`, `endDrag()`.
- Queries: `isConnected(color)`, `connectedCount()`, `filledCount()`,
  `isSolved()`, `pointerToCell(x, y)`.

Rendering is a plain 2-D canvas: grid lines, filled pipe cells, and endpoint dots
drawn on top. All game logic is independent of rendering so it is unit-testable.

## Assumptions

Where the task was ambiguous, the simpler interpretation was chosen and recorded
here:

- **Scoring is move count, not a timer.** Simpler to implement and test
  deterministically; lower is better.
- **Puzzles are hand-crafted full-cover tilings** rather than procedurally
  generated. This guarantees every shipped level is solvable and keeps the code
  free of a puzzle generator/solver. Layouts favour correctness over difficulty.
- **Overwrite semantics:** the newest pipe truncates any older pipe it crosses,
  matching Flow Free. There is no "locked" pipe.
- **Endpoints always count as filled** (each dot occupies its cell), so the empty
  starting board already has `2 × numColours` filled cells.
- **No touch-specific gestures** beyond pointer drag; mouse and touch share the
  same pointer handlers.
