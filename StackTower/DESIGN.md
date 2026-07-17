# Stack Tower — Design

## Concept

**Stack Tower** is a modern one-button arcade game. A block slides back and
forth across the top of a growing tower. Tap to drop it: the part that hangs
over the block below is sliced off and falls away, and whatever overlaps
becomes the new top of the tower — and the width the *next* block inherits.
Miss the block below entirely and the game is over.

The challenge is a self-inflicted difficulty curve: every imperfect drop makes
the tower a little narrower, so the higher you climb, the smaller your target
becomes. Land a drop dead-centre and it counts as a **perfect** — the width is
preserved instead of shrinking, and perfects in a row build a combo.

The whole game is skill on a single input, which makes it approachable but
hard to master — the classic "one more go" arcade loop.

## Mechanics

### The tower

- The tower is an array of stacked blocks, each a fixed height (`BLOCK_H`).
- The **base** block is placed automatically when a game starts, centred near
  the bottom of the canvas.
- The block on top of the stack (`blocks[blocks.length - 1]`) is the *target*
  the next block must overlap.

### The moving block

- After each successful drop a new block spawns one `BLOCK_H` above the current
  top, with the **same width** as the block it will land on.
- It slides horizontally, bouncing between the left and right edges of the
  canvas. Its horizontal speed increases slightly with every block placed, up
  to a cap, so the game gets faster as the tower grows.

### Dropping & slicing

When the player drops the moving block, it is compared against the top block:

- `overlapLeft  = max(moving.x, top.x)`
- `overlapRight = min(moving.x + moving.w, top.x + top.w)`
- `overlap = overlapRight - overlapLeft`

Then:

- **No overlap** (`overlap <= 0`) → the block misses entirely and the game
  ends.
- **Partial overlap** → a new block is created spanning only the overlap
  region (`x = overlapLeft`, `w = overlap`). The overhang is discarded (a
  falling "debris" sliver is spawned purely for visual flourish). The tower is
  now narrower.
- **Perfect drop** — the block's left edge is within `PERFECT_EPS` pixels of the
  top block's left edge. The block snaps exactly onto the top, keeps the **full
  width** (no shrink), and increments the perfect **combo** counter. Any
  non-perfect drop resets the combo to zero.

### Scoring

- **Score** = the number of blocks successfully stacked on top of the base
  (i.e. it starts at 0 and increments by 1 on every non-missing drop).
- **Best** score is persisted in `localStorage` under the key `stack-best`.

### Camera

The world can grow taller than the canvas, so a camera offset (`cameraY`)
scrolls the view upward to keep the active block near a fixed anchor row once
the tower is tall enough. The camera lerps smoothly toward its target each
frame. The camera is purely cosmetic and never affects gameplay logic.

## Controls

| Input | Action |
|---|---|
| **Space** / **↑** / **W** / click / tap on canvas | Drop the block — also starts / restarts the game |
| **P** | Pause / resume |

One button does everything: from the idle or game-over screen it starts a fresh
run, and during play it drops the current block.

## Determinism & testing

Following the repo convention (see Dino Run, Tetris, Snake), the game is a
single classic (non-module) script that exposes its state and logic as plain
globals so the Playwright suite can drive it directly:

- All motion is expressed **per second** and advanced through `step(dt)`, so
  tests simulate frames deterministically without depending on
  `requestAnimationFrame` wall-clock timing.
- Blocks can be spawned and positioned precisely via `spawnMovingBlock()` and by
  writing to `moving.x`, letting tests set up exact overlap / perfect / miss
  scenarios and assert the outcome of `dropBlock()`.
- `state` is one of `'idle' | 'running' | 'paused' | 'over'`.

## Assumptions

These are the simpler interpretations chosen where the brief was open-ended;
they are recorded here per the task's guidance.

- **Bouncing movement, not fly-through.** In the original arcade game blocks
  enter from off-screen and travel the full width. Here the moving block simply
  bounces between the canvas edges (`x` in `[0, CANVAS_W - w]`). This keeps the
  block always visible and the physics trivially deterministic, at the cost of
  a slightly different feel.
- **Score counts placed blocks**, not a size- or height-weighted score. It is
  the most obvious, legible metric and the easiest to reason about in tests.
- **Perfect detection uses the left edge** within a fixed pixel epsilon rather
  than sub-pixel centre alignment. Simpler and forgiving enough to feel good.
- **Perfect keeps the current width** (does not regrow the tower back toward the
  base width). Regrowth is a nice-to-have from some versions of the game but
  adds tuning complexity; a flat "no shrink on perfect" rule is clearer.
- **Debris slivers are cosmetic only** and are removed once they fall off the
  bottom of the view; they never interact with the tower or scoring.
- **Canvas size is fixed at 400×600** and the game does not scale to the
  viewport, matching the fixed-size approach of the other games in this repo.
