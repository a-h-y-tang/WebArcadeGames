# Tetris — Design

## Concept

A faithful, single-file implementation of the classic falling-block puzzle
arcade game. Seven tetromino shapes (I, O, T, S, Z, J, L) fall from the top of
a 10×20 well. The player slides and rotates each piece to pack them into
complete horizontal rows. A completed row clears, awards points, and the rows
above collapse down. The pieces fall faster as the player levels up. The game
ends when a newly spawned piece cannot fit — i.e. the stack reaches the ceiling.

## Board & rendering

- The well is **10 columns × 20 rows**. Each cell is `25px`, so the play-field
  canvas is **250 × 500**.
- Rendering is done on an HTML5 `<canvas>` with the 2D context. Every frame the
  board is repainted: background, a subtle grid, the locked stack, and the
  active falling piece. A small side canvas shows the **next** piece.
- The game loop is timestamp-driven via `requestAnimationFrame` (not
  `setInterval`), matching the Snake game already in this repo. Gravity fires
  once per `dropInterval()` which shortens as the level climbs.

## Mechanics

- **Tetrominoes** are stored as square matrices of 0/1. Rotation rotates the
  matrix 90° clockwise. Rotation near a wall attempts simple **wall kicks**
  (shift by -1, +1, -2, +2 columns) before being rejected.
- **Collision**: a piece collides if any of its filled cells is outside the
  left/right/bottom bounds or overlaps an already-locked cell. Cells above the
  top edge (`y < 0`) are allowed so pieces can spawn and rotate at the ceiling.
- **Locking**: when gravity (or a hard drop) can no longer move a piece down, it
  is written into the board. If any locked cell is above the ceiling, the game
  is over.
- **Line clears**: after each lock, full rows are removed and empty rows are
  inserted at the top. Points scale with the number of rows cleared at once:
  1→100, 2→300, 3→500, 4 (a "Tetris")→800, all multiplied by the current level.
- **Levelling**: `level = floor(linesCleared / 10) + 1`. Each level speeds up
  gravity down to a floor of 100 ms.
- **Scoring extras**: a soft drop (holding Down) awards 1 point per cell, a hard
  drop (Space) awards 2 points per cell dropped.

## Controls

| Key | Action |
|---|---|
| ← / → | Move piece left / right |
| ↑ | Rotate clockwise |
| ↓ | Soft drop (one row, +1 pt) |
| Space | Hard drop (drop to bottom & lock) |
| P | Pause / resume |
| Any arrow or Space (on overlay) | Start / restart |

The **Start / Play Again / Resume** button on the overlay mirrors the keyboard.

The best score is persisted to `localStorage` under the key `tetris-best`.

## Assumptions

- **File name** — the repo convention is a lowercase `design.md`, but the task
  brief explicitly asked for `DESIGN.md`. This file uses the requested
  `DESIGN.md` name and also serves as the game's design document.
- **Rotation system** — a simplified rotation with basic horizontal wall kicks
  is used rather than the full SRS kick tables. It feels natural for casual play
  and keeps the logic small and testable.
- **Randomiser** — the next piece is chosen uniformly at random. Tests that need
  determinism call the exposed `spawn(type)` helper or set `current` directly,
  the same approach the Snake tests use for food placement.
- **Start keys** — only the arrow keys and Space start the game (they are the
  game's controls), consistent with an arcade "press start" feel.
- No external assets, build step, or server are used — opening `index.html`
  directly runs the game, as required by the repo README.
