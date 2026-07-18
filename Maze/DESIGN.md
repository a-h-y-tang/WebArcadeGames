# Maze — Design

## Game concept

Navigate a procedurally generated maze from the entrance (top-left) to the exit
(bottom-right) before the timer runs out. Each maze you solve advances you to the
next level with a fresh, larger maze and a little more to remember. Run out of
time and the game ends. Your score is the number of mazes you cleared.

## Mechanics

- **Maze generation.** Each level builds a new *perfect* maze (exactly one path
  between any two cells, no loops) using an iterative recursive-backtracker
  (randomised depth-first search). The grid is `COLS × ROWS` cells; every cell
  tracks four walls `[top, right, bottom, left]`. Border walls are never removed,
  so the maze is always enclosed.
- **Entrance / exit.** The player starts at cell `(0, 0)` (top-left). The exit is
  cell `(COLS-1, ROWS-1)` (bottom-right), drawn as a glowing goal.
- **Movement.** The player moves one cell at a time. A move in a direction only
  succeeds if the wall on that side of the current cell is open *and* the target
  cell is inside the grid; otherwise the move is rejected and the player stays
  put.
- **Solving a level.** Reaching the exit cell clears the level: `score` and
  `level` increment, the grid grows (up to a cap), a new maze is generated, the
  player returns to `(0, 0)`, and the timer is topped up.
- **Timer.** Each level grants a time budget that scales with maze size. The
  timer counts down in real time via a `requestAnimationFrame` loop. When it
  reaches zero the game is over.
- **Scoring.** `score` = mazes cleared. `best` is persisted to `localStorage`
  under `maze-best`.

## Controls

- **Arrow keys** or **WASD** — move up / down / left / right.
- **Start / Play Again** button, or any movement key while idle / game-over —
  begin a new game.

## Testable surface

State is kept in top-level globals (matching the other games in this repo) so the
Playwright suite can drive the game deterministically:

- `maze` — 2-D array `[y][x]` of cells; each cell has `walls` = `[top, right,
  bottom, left]` booleans.
- `player` — `{ x, y }` current cell.
- `exit` — `{ x, y }` goal cell.
- `COLS`, `ROWS` — current maze dimensions.
- `level`, `score`, `best`, `timeLeft`, `state` (`idle` / `playing` / `over`).
- `startGame()` — begin a fresh game at level 1.
- `movePlayer(key)` — attempt a move; `key` is an arrow/WASD string. Same code
  path used by the keyboard handler. Returns `true` if the player moved.
- `solvePath()` — returns the list of move keys (breadth-first shortest path)
  from the player's current cell to the exit. Tests replay this to solve a level
  deterministically without depending on the random layout.
- `endGame()` — force game over (used by tests).

## Assumptions

- **Perfect mazes** (single solution, fully connected). This keeps `solvePath()`
  simple and guarantees every generated maze is solvable — the simplest correct
  interpretation.
- **The exit is always the far corner.** No keys, doors, or collectibles — the
  goal is pure navigation. (Simpler interpretation, per the task's guidance.)
- **No enemies or death by collision.** The only fail condition is the timer,
  which gives the game arcade tension while staying fully deterministic for
  tests (tests either replay `solvePath()` or call `endGame()` rather than
  waiting out the clock).
- **Grid grows with level** from a small starting size up to a fixed cap so the
  cells never get too small to see on a 500×500 canvas.
- **Best score** uses `localStorage`; it starts at 0 when storage is empty.
