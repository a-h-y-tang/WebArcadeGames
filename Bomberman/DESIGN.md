# Bomberman — Design

## Concept

A self-contained take on the classic **Bomberman**. The player navigates a
grid maze, dropping bombs that explode in a `+`-shaped blast after a short
fuse. Blasts destroy the soft **bricks** that litter the maze (sometimes
revealing a power-up) and kill any enemy — or the player — caught in them.
Clear every enemy to advance to the next, harder level. Walk into an enemy, or
get caught in your own blast, and you lose a life; run out of lives and the game
is over.

The whole game is one `index.html`, one `game.js`, and one `style.css` with no
build step and no external assets — matching the other games in this repo.

## The maze

- A **13 × 11** grid of 40 px cells (canvas 520 × 440).
- The outer ring and the interior pillars (every cell whose row *and* column are
  both even) are indestructible **walls**.
- The remaining cells are randomly seeded with destructible **bricks**, except
  the player's spawn corner `(1,1)` and its two neighbours, which are kept
  clear so the player can always move.
- Enemies spawn on cleared cells away from the player.

## Mechanics

- **Movement.** The player and enemies move one tile at a time. Holding a
  direction repeats the move after a short per-tile cooldown, giving a smooth
  "grid-locked" feel while staying perfectly deterministic. You cannot move into
  walls, bricks, or a cell that holds a bomb.
- **Bombs.** Space drops a bomb on the player's current tile (up to the current
  bomb limit, one per tile). After a **2 s** fuse the bomb detonates.
- **Blast.** The explosion covers the bomb's tile plus up to `range` tiles in
  each of the four directions. A wall stops the blast; a brick stops the blast
  *and* is destroyed. The blast lasts ~0.5 s; anything standing on a blast tile
  during that window dies.
- **Chain reactions.** A blast that reaches another bomb detonates it
  immediately.
- **Power-ups.** Some bricks hide a power-up, revealed when the brick is
  destroyed. Walking over it collects it:
  - **Flame** — increases blast `range` by 1.
  - **Extra Bomb** — increases the number of bombs you can have out at once.
- **Enemies.** Enemies wander the maze (continuing forward, turning at random —
  from a seeded PRNG — when blocked). Touching one costs the player a life.
  Catching one in a blast destroys it and scores points.
- **Scoring.** Brick destroyed **+10**, power-up collected **+50**, enemy
  destroyed **+100**.
- **Lives & levels.** Start with **3 lives**. Losing a life respawns the player
  at the corner with a brief invulnerability. Clearing all enemies advances to
  the next level, which rebuilds the maze with more enemies. `best` score is
  persisted to `localStorage` under `bomberman-best`.
- **Frame-rate independence.** All timers (fuses, blast lifetimes, move
  cooldowns, invulnerability) are integrated against real elapsed time by a
  single `step(dt)` function, kept separate from `draw()`.

## Controls

| Action           | Keys                       |
|------------------|----------------------------|
| Move             | Arrow keys or **W A S D**  |
| Drop bomb        | **Space**                  |
| Pause / resume   | **P**                      |
| Start / restart  | **Space** or an arrow key  |

## Testability

State and helpers live on the global scope (the pattern used by the other games
in this repo) so Playwright can drive the simulation deterministically:

- Globals: `state` (`idle` / `running` / `paused` / `over` / `won`), `grid`,
  `player`, `enemies`, `bombs`, `explosions`, `powerups`, `score`, `lives`,
  `level`, `best`, `COLS`, `ROWS`, `CELL`, `WIDTH`, `HEIGHT`.
- Functions exposed for tests: `startGame()`, `step(dt)`, `movePlayer(dc, dr)`,
  `placeBomb()`, `spawnEnemy(col, row)`, `cellAt(col, row)`, `isSolid(col,row)`.
- Because tests can set the grid, place bombs and enemies at exact tiles, and
  advance `step(dt)` by known amounts, no test depends on `Math.random`. The
  brick layout and enemy wandering used in real play come from a **seeded**
  PRNG (mulberry32), so a given level is reproducible.

## Assumptions

Chosen to keep the game simple; noted here per the task instructions:

1. **Tile-based movement** (one cell per move with a cooldown) rather than free
   pixel movement. This is the simpler, fully-deterministic interpretation and
   still plays smoothly when a direction is held.
2. **Two power-up types** (Flame, Extra Bomb) rather than the original's larger
   set — enough to give the maze meaningful rewards without bloat.
3. **Enemies use simple wander AI** (keep going, turn randomly when blocked)
   rather than pathfinding toward the player, keeping behaviour predictable and
   testable.
4. **Power-ups are not destroyed by later blasts** once revealed — a small
   simplification so the collection rules stay easy to reason about.
5. **Respawn is immediate** at the spawn corner with temporary invulnerability,
   rather than pausing the action, to keep the state machine simple.
6. **Canvas is 520 × 440** (13 × 11 tiles) rather than the square canvases of the
   other games, because a wide arena suits Bomberman's maze.
