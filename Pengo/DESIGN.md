# Pengo — Design

## Concept

**Pengo** is a canvas re-creation of the 1982 Sega maze-action arcade classic. You
play a penguin trapped in a field of ice blocks, hunted by wandering **Sno-Bee**
enemies. Your only weapon is the environment: **push a block and it slides across
the ice until it hits something** — and any Sno-Bee caught in its path is crushed.
Flatten every Sno-Bee to clear the level. Line up the three sparkling **diamond
blocks** for a big bonus. Touch a Sno-Bee and you lose a life.

It fills a genre gap in this repo: a real-time maze game whose core verb is
"**slide a block as a projectile**", distinct from Sokoban (push one cell, no
sliding, no enemies) and Boulder Dash (gravity-driven falling rocks).

## The field and coordinates

- The field is a grid **13 columns × 13 rows**. `grid[r][c]` holds a tile:
  `EMPTY (0)`, `ICE (1)` (a breakable pushable block), or `DIAMOND (2)` (an
  unbreakable pushable block). Row `0` is the top.
- The outer edge of the grid is a solid wall (anything outside `0..12`).
- Rendering uses `CELL = 36` px, so the canvas is `468 × 468`.
- The penguin (`player = {r, c}`) and the Sno-Bees (`enemies = [{r, c, alive}]`)
  live *on top of* the grid; they occupy `EMPTY` cells, never block cells.

## Mechanics

### Moving and pushing (immediate, on key press)

`movePlayer(dr, dc)` attempts to step the penguin one cell in a cardinal direction:

- **Into an empty cell:** the penguin moves. If a Sno-Bee is standing there, the
  penguin loses a life.
- **Into a block:** the penguin *pushes* it (`pushBlock`). The block **slides**
  in the push direction across consecutive empty cells until the next cell is a
  block or the wall. Any Sno-Bee the sliding block passes over is **crushed**
  (killed); the block continues through. If the block slid at least one cell, the
  penguin advances into the block's old cell.
- **A block with no room to slide** (a wall or another block immediately behind
  it): an `ICE` block **breaks** and vanishes; a `DIAMOND` block is immovable and
  nothing happens. The penguin stays put.

### The Sno-Bees (real-time, on a fixed tick)

`enemyStep()` advances every living Sno-Bee one cell. Each greedily chases the
penguin: it moves along whichever axis it is farther from the penguin on (vertical
first on a tie), into an empty cell it can enter; if that is blocked it tries the
other axis, otherwise it waits. A Sno-Bee cannot enter a block or a cell holding
another Sno-Bee, but it *can* step onto the penguin — which costs a life. The step
runs on a level-scaled timer, so enemies speed up as you advance.

### Diamonds

`diamondsAligned()` is true when the three diamond blocks share a row (or column)
in three consecutive cells. Achieving that alignment awards a one-time bonus per
level.

### Lives, levels, scoring

- Crushing a Sno-Bee scores `100`; breaking an ice block scores `10`; aligning the
  diamonds scores `500`; clearing a level scores a `level × 200` bonus.
- Clearing all Sno-Bees (`levelCleared()`) advances to the next level: a fresh
  field with one more Sno-Bee (capped) and a faster tick.
- You start with **3 lives**. Losing one respawns the penguin at its start and
  returns the Sno-Bees to their spawns (the field of blocks persists). Losing the
  last life ends the game. The best score persists in `localStorage` (`pengo-best`).

## Controls

| Input | Action |
|---|---|
| ← ↑ → ↓ or W A S D | Move / push in that direction |
| **P** | Pause / resume |
| **R** | Restart |
| Any arrow / WASD, or **Start** | Begin from the idle screen |

## Game states

`state` is `idle` (start overlay), `playing`, `paused`, or `over` (game-over
overlay). The animation loop only advances the Sno-Bees while `playing`.

## Testable API (globals for Playwright)

The game runs as a classic (non-module) script so its state and pure helpers are
reachable as globals, mirroring the other games in this repo:

- State: `grid`, `player`, `enemies`, `score`, `lives`, `level`, `best`, `state`.
- Tiles: `EMPTY`, `ICE`, `DIAMOND`.
- Logic: `movePlayer(dr, dc)`, `pushBlock(r, c, dr, dc)`, `enemyAt(r, c)`,
  `enemyStep()`, `diamondsAligned()`, `levelCleared()`.
- Flow: `startGame()`, `reset()`, `stopLoop()`.

The push/slide/crush logic and the enemy step are pure functions of the exposed
state with no dependence on wall-clock time or randomness, so tests carve an exact
field, call one function, and assert the outcome. `stopLoop()` lets a test freeze
the real-time tick while it sets up a precise scenario.

## Assumptions

Chosen to keep the first version focused; each is a reasonable reading of an
ambiguous requirement:

1. **13×13 field, 3 lives, 3 starting Sno-Bees** (+1 per level, capped at 6).
2. **Sliding blocks crush every Sno-Bee in their path and pass through**, rather
   than modelling a Sno-Bee being shoved along — the classic crush feel, simplified.
3. **Sno-Bees chase greedily and do not break blocks or hatch from eggs.** The
   original's wall-stun and egg mechanics are omitted for simplicity.
4. **A fixed, deterministic starting layout per level** (an even-grid lattice of ice
   with three diamonds) rather than a randomised maze, so play is reproducible.
5. **Diamond alignment** requires three *consecutive* cells in a line, and awards a
   one-time bonus per level.
6. **Deterministic tests drive `movePlayer` / `enemyStep` directly** and set the
   grid/entities explicitly instead of seeding an RNG.
