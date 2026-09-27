# Rally-X — Design

## Concept

Rally-X is a top-down maze rally. You drive a blue car through a walled circuit
that is four times larger than the screen, hunting **ten flags** while a pack of
red pursuit cars hunts *you*. The screen scrolls to follow your car, so you can
never see the whole course at once — a **radar** panel beside the track shows the
entire circuit in miniature, with every flag, every chaser and your own car on
it. Reading the radar and planning a route through it is the game.

You cannot shoot. Your only weapon is a **smoke screen**: a puff of exhaust
dropped behind the car that spins out any chaser that drives into it. Smoke
burns fuel, and fuel is also the clock — run the tank dry and the car crawls at
half speed for the rest of the level with no smoke left to defend itself.

Collect all ten flags to clear the level. The next circuit is a different maze
with an extra chaser and faster cars.

## The circuit

| Thing | Value |
|---|---|
| Maze grid | 24 × 24 tiles |
| Tile size | 32 px |
| World | 768 × 768 px |
| Viewport (`#canvas`) | 480 × 480 px, scrolls with the car, clamped to the world |
| Radar (`#radar`) | 144 × 144 px — the whole world at 6 px per tile |

### Maze generation

Mazes are generated from a **seeded RNG** (`mulberry32`) whose seed is derived
from the level number, so level *n* always produces the same circuit. That makes
the game replayable-by-level and makes the tests deterministic.

1. Every border tile is a wall.
2. A pillar is placed at each interior tile whose column and row are both odd.
   On its own this is an open lattice: every even row and even column is a clear
   one-tile-wide corridor, which is the roomy, drivable feel Rally-X needs.
3. Each pillar is then extended by one tile in a random cardinal direction with
   probability `EXTEND_CHANCE` (0.55), breaking the lattice into an irregular
   circuit with dead ends, long runs and blind corners.
4. A flood fill runs from the start tile. Any open tile the fill cannot reach is
   **filled in as wall**. This is simpler than carving a path to it and it
   guarantees, by construction, that every open tile of the finished maze is
   reachable — so no flag or chaser can ever spawn somewhere unreachable.

### Placement

The player starts at the reachable open tile nearest the middle of the world.
Flags and chasers are drawn from the reachable tiles, shuffled with the same
seeded RNG, subject to a minimum grid distance from the start (`8` for flags,
`10` for chasers) so nothing is sitting on the bumper at the start of a level.

## Mechanics

### Driving

Cars are Pac-Man-style grid drivers: a pixel position, a current direction, and
a *wanted* direction held from the last key press. The wanted direction is taken
up as soon as the car is within `TURN_TOL` (3 px) of the centre line of its
tile and the tile that way is open; the car snaps to the centre line as it
turns, so it never ends up wedged half in a wall. Driving into a wall clamps the
car at the centre of its current tile — it stops, it does not bounce.

Reversing is always legal for the player, because the alignment test for a
reversal is on the axis the car is already locked to.

### Chasers

Each chaser re-decides its direction whenever it reaches the centre of a new
tile. It lists the open directions, drops the reverse of its current heading
(unless that is the only way out of a dead end), and takes the one that most
reduces the straight-line distance to the player. With probability
`ENEMY_RANDOM` (0.22) it picks a legal direction at random instead — without
that they converge into a single-file train and the game stops being fun.

Chasers are slower than the player (`ENEMY_SPEED_BASE` 82 px/s versus
`PLAYER_SPEED` 104 px/s) and gain `ENEMY_SPEED_PER_LEVEL` (5 px/s) each level.
The player is always faster in a straight line; you lose by being cornered, not
by being outrun.

### Smoke screen

Space drops a smoke cloud on the tile behind the car for `SMOKE_COST` (5) fuel.
The cloud lives `SMOKE_LIFE` (3 s) and has radius `SMOKE_RADIUS` (13 px). A
chaser whose centre enters a cloud **spins out** for `SPIN_TIME` (2.6 s): it
stops dead, and while spinning it is harmless — you can drive straight through
it. That is what makes smoke a real defensive option in a corridor rather than
just a delay.

### Fuel

The tank holds `FUEL_MAX` (100) and drains `FUEL_DRAIN` (1.5) per second while
driving, plus 5 per smoke. At zero the car does not die: it drops to
`EMPTY_SPEED_FACTOR` (0.5) of its speed and can no longer make smoke, which
usually means the chasers catch you shortly afterwards. Clearing a level refills
the tank and pays a bonus of `round(fuel) × FUEL_BONUS` (10) points.

### Flags and scoring

| Event | Points |
|---|---|
| Flag | `FLAG_BASE` (100) |
| Flag after the lucky flag | 200 |
| Level cleared | `round(remaining fuel) × 10` |

Exactly one of the ten flags each level is the **lucky flag**, drawn in gold and
marked on the radar. It scores 100 like any other, but every flag collected
*after* it in that level is worth double. Doubling applies for the rest of the
level only; the next circuit starts back at 100.

### Lives and losing

You start with `START_LIVES` (3) cars. Touching a chaser that is not spinning
(centres within `HIT_DIST`, 11 px) wrecks the car: the level pauses for
`DYING_TIME` (1.4 s), then the player and every chaser return to their spawn
tiles with the flags you have already taken still collected. Fuel is *not*
refilled on a wreck — a bad level stays bad. Losing the last car ends the game.

## Controls

| Input | Action |
|---|---|
| Arrow keys / `WASD` | Steer |
| `Space` | Drop a smoke screen |
| `Space` / `Enter` / Start button | Start a game, or restart after game over |
| `P` | Pause / resume |

## States

`idle` → `playing` → (`dying` → `playing`) → (`levelclear` → `playing`) →
`gameover` → `idle`-like restart. `paused` is entered from and returns to
`playing`.

## Test seams

The game exposes its state and a few helpers as globals so Playwright can drive
it deterministically instead of racing an animation frame:

- `setAutoPlay(false)` stops the `requestAnimationFrame` loop; `step(dt)`
  advances the simulation by an exact number of seconds.
- `startGame()`, `resetGame()`, `dropSmoke()`, `placeAt(entity, col, row)`,
  `isWall(col, row)`, `tileOf(entity)`.
- State: `state`, `score`, `lives`, `level`, `fuel`, `flagValue`, `player`,
  `enemies`, `flags`, `smokes`, `maze`, `camera`.

## Assumptions

These are the judgement calls made where the brief or the original arcade game
left room, resolved toward the simpler reading:

1. **Branch.** The task asked for a branch named after the game
   (`rally-x`), but this session's standing instructions pin all work to
   `claude/compassionate-ramanujan-or1wp1`. The pinned branch wins; the game
   folder and browser id carry the `rally-x` name instead.
2. **Running out of fuel slows the car rather than killing it**, matching the
   arcade. It is a soft failure, not an instant loss.
3. **Spinning chasers are harmless.** The arcade is ambiguous here; making smoke
   genuinely protective is the simpler and more readable rule.
4. **No rocks.** The arcade scatters rocks that wreck cars on contact; the maze
   walls already fill that role, and a second static hazard would not add a new
   decision.
5. **No sweeping bonus for the "special" flag beyond doubling.** One lucky flag
   doubling subsequent flags is the whole mechanic; no extra fuel or lives.
6. **Wrecking does not refill the tank**, so fuel pressure survives a mistake.
7. **Unreachable pockets are filled in, not carved open**, so the maze always
   has exactly one connected drivable region.
8. **Fixed 10 flags on every level.** Difficulty scales through chaser count and
   speed only, which is one dial instead of three.
