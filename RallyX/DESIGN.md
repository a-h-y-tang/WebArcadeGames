# Rally-X — design

How the code works, and why it is shaped the way it is.

## Game concept

A top-down maze chase inspired by Namco's *Rally-X* (1980). You drive a blue
rally car through a scrolling blocky maze, collecting ten yellow flags while
red pursuit cars hunt you down. You cannot shoot: your only weapon is a smoke
screen dropped out of the exhaust, which spins out any chaser that drives into
it. Both driving and smoking burn fuel, and running dry costs a life, so every
lap is a race between the flags you still need and the gauge on the HUD.

A radar panel to the right of the playfield shows the whole maze at a glance —
flags, chasers and the slice of the world currently on screen — because the
viewport only shows part of the maze at a time.

## Playfield

| Thing | Value |
|---|---|
| Canvas | 608 × 448 |
| Viewport (scrolling maze) | 448 × 448 at (0, 0) |
| Radar panel | 160 × 448 at (448, 0) |
| Maze | 24 × 24 tiles of 32 px → 768 × 768 world |

The camera follows the car and clamps to the world bounds, so the maze never
scrolls past its own edge.

### Maze generation

Mazes are generated per level from a seeded PRNG (`mulberry32`), so a given
seed always produces the same maze — that is what makes the Playwright specs
able to assert on maze shape.

1. Ring of solid wall around the outside.
2. A pillar at every interior tile whose column and row are both even
   (2, 4, … 20). That alone gives the open, loop-rich lattice a chase game
   needs — dead ends make for a frustrating pursuit.
3. Each pillar is then extended by one tile in a random direction with
   probability `WALL_EXTEND_CHANCE`, **only if** the maze stays fully
   connected afterwards (checked with a flood fill). The extensions are what
   turn a boring lattice into corridors, chicanes and long straights.

Connectivity is a hard invariant: every open tile is reachable from every
other, so no flag can be walled off and no chaser can be trapped.

### Flags

Ten flags are dropped on open tiles, at least `FLAG_MIN_START_DIST` tiles from
the car's start and at least `FLAG_MIN_SPACING` tiles from each other, so they
are spread across the maze instead of clustered. Exactly one of them — never
the first one you are likely to meet — is a **special flag** (drawn with an
"S"): from the moment you take it, every remaining flag in the level is worth
double.

## Mechanics

- **Driving.** Movement is grid-aligned in the Pac-Man tradition: the car
  drives along corridor centre lines, and a turn is committed only when the
  car is aligned with a tile centre and the tile in the new direction is open.
  Pressing a direction that is not yet legal stores it as the *wanted*
  direction and it is taken at the first tile where it becomes legal, so
  turns feel forgiving. Reversing is always legal.
- **Chasers.** Each red car re-decides at every tile centre, picking the legal
  direction that most reduces its straight-line distance to the player.
  Reversing is only allowed out of a dead end, which keeps them committed and
  readable rather than jittery. They are slower than you (`ENEMY_SPEED`
  vs `CAR_SPEED`), and get a little faster each level up to a cap.
- **Smoke screen.** <kbd>Space</kbd> drops a cloud behind the car for
  `SMOKE_COST` fuel. Any chaser that touches a cloud spins out for
  `STUN_TIME` seconds and is worth `SMOKE_POINTS`. Clouds fade after
  `SMOKE_LIFE` seconds.
- **Fuel.** Starts full each level and drains at `FUEL_DRAIN` per second, plus
  whatever the smoke costs. Empty tank = lost life.
- **Dying.** Touching a chaser, or running out of fuel, costs a life; the
  level restarts with the flags you have not yet taken still missing. Out of
  lives is game over. Clearing all ten flags scores a fuel bonus
  (`FUEL_BONUS_PER_UNIT` per remaining unit) and moves you to the next level,
  which adds a chaser (up to `MAX_ENEMIES`), speeds them up and gives you a
  fresh maze.

## Controls

| Input | Action |
|---|---|
| <kbd>←</kbd> <kbd>→</kbd> <kbd>↑</kbd> <kbd>↓</kbd> or <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> | Steer |
| <kbd>Space</kbd> | Drop smoke screen (also starts the game) |
| <kbd>Enter</kbd> | Start / restart |
| <kbd>P</kbd> | Pause |

## Code layout

Single classic (non-module) script, matching BurgerTime, Kaboom! and the rest
of the repo, so state and helpers are reachable from the Playwright specs as
plain globals. All motion is per-second and applied through `step(dt)`; the
`requestAnimationFrame` loop is nothing but a `step` + `draw` pump.

| Section of `game.js` | Responsibility |
|---|---|
| Constants | Tunables — sizes, speeds, scoring, timings |
| RNG | `mulberry32`, `setSeed`, `rngInt` |
| Maze | generation, `isWall`, connectivity flood fill |
| Grid helpers | `colOf`/`rowOf`/`tileCenter`, `alignedOn`, `canEnter` |
| Entities | `advanceEntity` (shared car/chaser motion), chaser AI |
| Flags / smoke | placement, pickup, cloud lifetime and stunning |
| Run structure | `startGame`, `nextLevel`, `respawn`, `gameOver`, `togglePause` |
| `step(dt)` | the whole simulation, one dt at a time |
| `draw()` | viewport render + radar panel |
| HUD / input / loop | DOM plumbing |

### Test seams

Deliberately exposed so the specs can be deterministic rather than flaky:

- `step(dt)` — advance the simulation by an exact slice of time.
- `autoStep` — set to `false` and the rAF loop only draws, so the specs are
  the sole source of simulated time.
- `setSeed(n)` + `resetLevel()` — rebuild an identical maze on demand.
- `enemiesEnabled` — freeze the chasers for specs about driving, flags or fuel.
- `placeCar(col, row)` / `placeEnemy(i, col, row)` — teleport instead of having
  to drive there.
- `car`, `enemies`, `flags`, `smokes`, `maze`, `camera`, `state`, `score`,
  `fuel`, `lives`, `level` — plain globals.

## Assumptions

Made autonomously while building this, choosing the simpler reading wherever
the brief or the original arcade game was ambiguous:

1. **Branch name.** The task asked for a branch named after the game
   (`rally-x`), but this session is also required to develop and push only on
   its designated branch `claude/compassionate-ramanujan-rwxm7u`. The
   designated-branch rule wins, since pushing elsewhere is explicitly
   forbidden; the game still lives in its own `RallyX/` folder.
2. **Out of fuel costs a life** rather than the arcade's "car slows to a
   crawl and is inevitably caught" — the simpler, more legible rule, and it
   keeps the fuel gauge meaningful.
3. **No rocks.** The arcade maze has rock obstacles that also kill you; walls
   plus chasers give the same pressure with less to explain, so they are left
   out.
4. **Lucky flags are not implemented** — only the special (double-value) flag,
   which is the mechanic that actually changes how you route through the maze.
5. **Fixed enemy count per level** (`2 + level`, capped) instead of the
   arcade's staged waves.
6. **Deterministic mazes from a seed.** The arcade used fixed hand-drawn
   maps; generating from a seed gives variety for free and stays testable.
7. **Scoring** is simplified to: 100 per flag, doubled after the special flag,
   200 per chaser smoked, and 10 per remaining fuel unit at level clear.
