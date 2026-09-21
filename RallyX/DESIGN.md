# Rally-X — Design

## Concept

Rally-X is a top-down maze driving game. You steer a blue rally car through a
scrolling maze, collecting all ten yellow flags before the red chase cars catch
you. The car burns fuel continuously, and the only weapon you have is a smoke
screen: dropping a cloud behind you spins out any chase car that drives into
it, at the cost of some fuel.

The maze is larger than the viewport, so the play area scrolls with the car and
a radar panel beside it shows the whole maze at a glance — where the flags are,
and where the chase cars are coming from.

## Files

| File | Purpose |
|---|---|
| `index.html` | Page shell: HUD, main canvas, radar canvas, overlay, help text |
| `style.css` | Arcade cabinet styling for the HUD, canvases and overlay |
| `game.js` | All game logic and rendering — a single classic (non-module) script |
| `tests/rallyx.spec.js` | Playwright suite driving the game through its globals |

`game.js` is deliberately a plain script rather than an ES module: every piece
of state (`car`, `enemies`, `flags`, `smokes`, `state`, `fuel`, …) and the pure
step function (`step(dt)`) are reachable from Playwright as window globals, the
same convention the other games in this repo use.

## Coordinate systems

There are three:

1. **Cell coordinates** `(c, r)` — integer indices into `MAZE`, 19 columns by
   15 rows. `isWall(c, r)` is the single source of truth for collision.
2. **World pixels** — cells are `CELL = 32` px, so the world is 608 × 480 px.
   Every moving entity stores its position as a world-pixel centre point.
3. **Screen pixels** — the canvas is a 480 × 384 window onto the world. The
   camera centres on the car and is clamped to the world bounds, so the view
   never shows outside the maze.

The radar canvas draws the whole world at 8 px per cell (152 × 120).

## Maze

`MAZE` is a hand-authored, fixed layout (no random generation — a fixed maze
keeps the game learnable and the tests deterministic). It is built from solid
rectangular blocks that never touch each other or the outer wall, which
guarantees that every open cell is reachable from every other one and that the
maze contains no dead ends: you can always drive out of trouble.

## Movement model

Both the player and the chase cars use the same grid-aligned movement, applied
by `moveEntity()`:

- An entity always travels along one axis at a time and stays snapped to the
  centre line of its corridor on the other axis.
- Steering sets a **wanted** direction. A reversal takes effect immediately;
  any other turn is taken at the next cell centre, and only if the cell in that
  direction is open. This is the classic "queue the turn" feel — you can press
  early as you approach a junction.
- Driving into a wall stops the car at the centre of the last open cell. The
  player then sits still until steered again (chase cars pick a new direction
  immediately).

Player speed is `CAR_SPEED` (104 px/s), dropping to 55 % of that when the tank
runs dry. Chase cars are slower than a fuelled player car but faster than an
empty one, so running out of fuel is dangerous without being an instant loss.

## Chase-car AI

At each cell centre a chase car scores its available directions by the Manhattan
distance from the next cell to the player and takes the best one, never
reversing unless that is the only option. Each car carries a `bias` offset that
shifts the target a couple of cells to one side, so the pack spreads out and
tries to pincer the player instead of forming a single queue. A stunned car
does not move and cannot hurt the player.

## Smoke screen

`dropSmoke()` costs `SMOKE_COST` (6) fuel and leaves a cloud at the car's
position for `SMOKE_LIFE` (4 s). A chase car whose centre comes within
`SMOKE_RADIUS` of a cloud spins out for `STUN_TIME` (3 s). Clouds are not
consumed by a hit, so one well-placed cloud can stop a whole pack.

## Scoring and round structure

- Each flag is worth `FLAG_POINTS` (100) × the current multiplier.
- One flag per round is a **lucky flag** (drawn in green with an "S"): taking it
  awards its own value and then doubles the multiplier for the rest of the
  round.
- Clearing all ten flags ends the round and pays a fuel bonus of 10 points per
  whole unit of fuel remaining.
- Each round refills the tank, re-lays the flags from a rotating table of fixed
  spots, and adds a chase car up to a maximum of five. Chase cars also gain a
  little speed per round, capped below the player's fuelled speed.
- Crashing into a chase car costs a life (three to start). Flags already taken
  stay taken; the cars and the player return to their starting cells. The best
  score is kept in `localStorage` under `rallyx-best`.

## Controls

| Input | Action |
|---|---|
| Arrow keys / WASD | Steer |
| Space | Drop a smoke screen (also starts the game from the title/game-over screen) |
| Enter | Start / resume |
| P | Pause |
| Start button | Start / resume |

## Game states

`idle → running → (paused) → dying → running → … → over`, plus `levelclear`
between rounds. `dying`, `levelclear` and `over` are handled inside `step()` on
timers, so the whole game — including the pauses between rounds — can be driven
deterministically by the tests.

## Test seam

`frame()` (the `requestAnimationFrame` driver) only calls `step(dt)` while
`autoStep` is true. Tests call `setAutoStep(false)` and then pump `step(dt)`
themselves, so no assertion depends on wall-clock timing. Nothing else in the
game reads `autoStep`; rendering keeps running so the screenshot and any manual
debugging still work.

## Assumptions

These are the judgement calls made where the brief was open-ended:

1. **Branch name.** The task asked for a branch named after the game
   (`rally-x`), but this session is also instructed to develop and push only on
   its designated branch. The designated branch wins; the game name is used for
   the folder (`RallyX/`) instead.
2. **Faithfulness to the arcade original.** This is a Rally-X *inspired* game,
   not a reproduction. The rocks that block the original's maze, the fuel-low
   siren, the "special" round layouts and the exact arcade maze are all left
   out in favour of the simpler core loop: flags, chase cars, smoke, fuel.
3. **Stopping at walls.** The arcade car keeps rolling into a wall; here the car
   stops at the last open cell centre. This is the simpler and more forgiving
   interpretation, and it makes movement assertions exact.
4. **Stunned cars are harmless.** Rather than model a spinning car that can
   still clip you, a smoked car is simply inert until it recovers.
5. **Fixed maze, fixed flag spots.** No procedural generation. Rounds differ by
   which ten of the eighteen flag spots are used (a rotating window), how many
   chase cars there are, and how fast they drive.
6. **Fuel never ends the round.** An empty tank slows the car rather than
   killing it, so a round can always be finished.
