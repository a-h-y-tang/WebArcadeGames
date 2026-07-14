# Pac-Man — Design

## Concept

A compact take on the 1980 maze classic. Guide Pac-Man around a walled maze,
eating every pellet while three ghosts hunt you down. Grab a flashing **power
pellet** and the tables turn — the ghosts panic and you can eat them for big
points. Clear the maze to advance to a faster level. Get caught by a ghost and
you lose a life; lose all three and it's game over.

Runs entirely on a single HTML5 `<canvas>` — open `index.html`, no build step.

## Mechanics

- **Grid maze.** The maze is a fixed 19×21 tile grid (`#` walls, `.` pellets,
  `o` power pellets). It was authored so the whole open area is a single
  connected region and there are exactly four power pellets, one per corner.
- **Tile-tick movement.** Every entity moves one whole tile per "tick". Pac-Man
  and the ghosts advance in lock-step, which keeps the simulation perfectly
  deterministic and easy to test. On-screen the motion is smoothly interpolated
  between tiles so it doesn't look choppy.
- **Steering.** You set a *desired* direction with the arrow keys or WASD;
  Pac-Man turns to it as soon as that direction is open (so you can pre-turn
  into a junction), otherwise he keeps going until he hits a wall and stops.
- **Pellets.** Eating a pellet scores 10; a power pellet scores 50 and starts a
  6-second **frightened** window.
- **Ghosts.** Each tick a ghost picks the legal move (never reversing, unless
  boxed in) that best serves its goal, with a fixed up→down→left→right
  tie-break so behaviour is deterministic:
  - **Chase** (normal): step that *minimises* Manhattan distance to Pac-Man.
  - **Frightened** (power active): step that *maximises* distance from Pac-Man
    — they flee — and they can be eaten.
  - **Eyes** (just eaten): head back to the pen; harmless to Pac-Man until they
    arrive home and revive.
- **Eating ghosts.** While frightened, touching a ghost scores 200 and turns it
  into eyes that scurry home. Touching a normal ghost costs a life and resets
  everyone's position (pellets are kept).
- **Levels.** Clear every pellet and the maze restocks, positions reset, and the
  tick gets faster (down to a floor), so later levels are harder.
- **Best score** persists to `localStorage` under `pacman-best`.

## Controls

| Action          | Keys                        |
|-----------------|-----------------------------|
| Move            | `←` `↑` `→` `↓` or `W A S D` |
| Pause / resume  | `P`                         |
| Start / restart | `Space` or any arrow while idle/over |

## Architecture

Mirrors the conventions of the other games in this repo:

- **State machine**: `idle`, `running`, `paused`, `over`. An overlay `<div>` is
  shown for every state except `running`.
- **Deterministic simulation.** `moveOnce()` advances the whole world by exactly
  one tile-tick (move Pac-Man → eat → move ghosts → resolve collisions).
  `step(dt)` accumulates real elapsed time and calls `moveOnce()` once per
  `stepMs`, so physics is frame-rate independent. The Playwright tests drive
  `moveOnce()` / `handleCollisions()` directly for tile-exact, race-free checks.
- **Globals for testability.** `pac`, `ghosts`, `pellets`, `dotsLeft`, `score`,
  `lives`, `level`, `state`, the maze constants, and the core functions are all
  declared at script top level so tests can read and manipulate them through
  `page.evaluate`, exactly as the other games' tests do.
- **Rendering** interpolates each entity between its previous and current tile by
  `moveAcc / stepMs` for smooth motion; walls are rounded blue tiles, pellets are
  dots, frightened ghosts turn blue and flash as time runs out.

## Assumptions

Chosen to keep this first version simple; recorded here per the repo's guidance:

- **Ghosts and Pac-Man move at the same speed** (one tile per tick). The arcade
  slows frightened ghosts and varies speeds per level; here only the *behaviour*
  changes when frightened, not the speed. The maze layout and clumping AI still
  make it winnable.
- **All ghosts chase Pac-Man directly** (Blinky-style), rather than each using a
  distinct target/scatter personality. They differ only in colour.
- **No ghost "leave the pen" timing.** Ghosts start on open path tiles and roam
  immediately; there is no pen-exit sequence.
- **No side tunnels / screen wrap.** The maze is fully walled on all four edges.
- **Ghost-eat bonus is a flat 200** rather than the doubling 200/400/800/1600
  chain of the original.
- **Canvas is a fixed 456×504** (19×21 tiles at 24px). No responsive resizing.
