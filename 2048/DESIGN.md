# 2048 — Design

## Game concept

2048 is a sliding-tile puzzle played on a 4×4 grid. Every move slides **all**
tiles as far as they can go in one of four directions. When two tiles of the same
value collide they **merge** into one tile of double the value, adding that value
to your score. After each move that changes the board, a new tile (a 2, or
occasionally a 4) appears in a random empty cell. You win the moment a **2048**
tile is formed — but you can keep going for a higher score. The game ends when the
board is full and no merges are possible.

## Board & rendering

- The grid is **4×4**, stored as `grid[row][col]` where `0` means an empty cell
  and any other value is a tile value (a power of two).
- The canvas is **400 × 400**. Cells are laid out with a uniform gap so tiles read
  as rounded rounded squares on a padded board, each labelled with its value.
- Rendering is 2D canvas. Because 2048 is turn-based (no real-time physics), the
  board is redrawn only after each move rather than on an animation loop.

## Core logic — `collapse`

All movement reduces to a single pure function, `collapse(line)`, which takes a
4-element array (ordered so index 0 is the destination edge) and returns the new
line plus the score gained:

1. Drop zeros — compact the non-zero values toward index 0.
2. Merge — walking from index 0, if two neighbours are equal, combine them into
   one tile of double value and add that value to the gained score. Each tile may
   take part in **at most one merge per move**.
3. Pad the result back to length 4 with zeros.

Examples: `[2,2,0,0] → [4,0,0,0]` (+4); `[2,2,2,2] → [4,4,0,0]` (+8);
`[4,4,8,0] → [8,8,0,0]` (+8); `[2,4,2,4] → [2,4,2,4]` (+0).

A full move (`applyMove(dir)`) builds each row or column as a line oriented toward
the movement direction, runs `collapse`, and writes it back. It reports whether
anything actually changed.

## Mechanics

- **Move & spawn:** `move(dir)` runs `applyMove`; if the board changed, it adds a
  random tile (90% a 2, 10% a 4) to a random empty cell, updates the best score,
  and then checks for win / game-over.
- **Win:** the first time a 2048 tile appears, a "You Win!" banner shows; pressing
  any key (or **Keep Going**) resumes play so you can chase a higher score.
- **Game over:** when there are no empty cells and no adjacent equal tiles in any
  direction, the game ends.
- **Scoring:** the score increases by the value of every merged tile. The best
  score persists to `localStorage` under the key `best-2048`.

## Controls

| Key | Action |
|---|---|
| ← / A | Slide left |
| → / D | Slide right |
| ↑ / W | Slide up |
| ↓ / S | Slide down |

Any of these keys (or the **Start** button) begins the game from the opening
overlay; after a game over the same keys restart it.

## State model

`state` moves through `idle` → `running` → (`won` →) `running` → `over`. The
overlay is shown for every state except `running`. Globals exposed for rendering
and testing: `grid`, `score`, `best`, `state`, `won`, plus helpers `collapse`,
`applyMove`, `move`, `addRandomTile`, `canMove`, `isGameOver`, `startGame`,
`endGame`.

## Assumptions

Simpler interpretations chosen where the task was ambiguous:

- **README status column.** The repo README's game table had no status column. A
  **Status** column was added so each game shows `In Progress` / `Complete` as the
  task requires; existing entries are backfilled as `Complete`.
- **No pause.** 2048 is turn-based with no real-time clock, so a pause control adds
  nothing; it is intentionally omitted (unlike the real-time Snake game).
- **Win is non-terminal.** Reaching 2048 shows a win banner but lets you keep
  playing, matching the original game. Only a stuck board ends the run.
- **Spawn distribution.** New tiles are 2 (90%) or 4 (10%), the standard rule.
- **Playwright pinned to `^1.56.0`.** The repo previously pinned `^1.49.0`, which
  resolves to a browser build not present in the test environment; `1.56.0` matches
  the available Chromium build so the suite can run.
