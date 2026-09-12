# Ski Slalom — Design

## Game concept

An endless downhill ski run on an HTML5 canvas. The camera looks straight down
the fall line: the skier sits at a fixed height on screen and the mountain
scrolls up past them. You steer by carving left and right, threading pairs of
slalom flags for points while dodging the trees and rocks scattered down the
piste, and launching off ramps for air-time bonuses. The run never ends — it
just gets faster and more crowded — and it is over when three crashes have used
up your lives.

Nothing else in the repo uses this shape of play. The other "dodge" games are
lane-based (Road Rush), jump-timed side-scrollers (Dino Run, Moon Patrol) or
top-down mazes. Ski Slalom is built around a *steering-angle* model where the
same input controls both your lateral movement and your speed: point straight
down the hill and you go fast but cannot move sideways much; carve hard across
the hill and you can cross the piste quickly but you bleed speed. Every gate is
a small decision about how much speed to trade for position.

## World and camera

The world is a single vertical strip. World `y` grows downhill without bound;
world `x` is the piste, clamped to the canvas width.

| Constant | Value | Meaning |
|---|---|---|
| `CANVAS_W` | 560 px | piste width |
| `CANVAS_H` | 620 px | visible run ahead |
| `SKIER_SCREEN_Y` | 190 px | fixed screen height of the skier |
| `PX_PER_METER` | 12 | world pixels per displayed metre |
| `EDGE_MARGIN` | 18 px | how close to the piste edge the skier may get |

The camera is derived, never stored: `cameraY = skier.y - SKIER_SCREEN_Y`, and
anything in the world is drawn at `y - cameraY`. `distance` is
`floor(skier.y / PX_PER_METER)` and is the number shown in the HUD as metres.

## Mechanics

### Steering, speed and the carve trade-off

The skier carries a steering `angle`, measured in radians away from the fall
line, clamped to `±MAX_ANGLE` (1.15 rad, about 66°). Left and right rotate it at
`TURN_RATE` (3.0 rad/s) on the ground and `TURN_RATE_AIR` (1.1 rad/s) in the
air. Nothing re-centres the angle — the skier holds the line you left them on.

Speed chases a target that depends on that angle:

```
cap    = min(SPEED_CAP_MAX, SPEED_BASE + distance * SPEED_GROWTH)
target = SPEED_MIN + (cap - SPEED_MIN) * cos(angle)      // × BRAKE_FACTOR when braking
```

so pointing straight down (`angle = 0`) accelerates toward the full cap, and a
hard carve settles near `SPEED_MIN`. `speed` moves toward `target` at `ACCEL`
when it is below and `DECEL` when it is above, which makes braking bite harder
than accelerating. Velocity is then the obvious decomposition:

```
vx = speed * sin(angle)      vy = speed * cos(angle)
```

Because the target already scales with `cos(angle)`, carving costs downhill
speed twice over — once in the target and once in the projection — which is what
makes a hard carve feel like a real handbrake.

The speed cap grows with distance (`SPEED_BASE` 210 → `SPEED_CAP_MAX` 420 px/s),
so the run gets faster the further you survive.

### Gates

A gate is one pair of flags, stored as a point `{ x, y, state }` with the gap
running from `x - GATE_HALF` to `x + GATE_HALF` (`GATE_HALF` = 46, so a 92 px
gap). A pending gate is judged on the first frame the skier is past its line
(`skier.y > gate.y`):

- `|skier.x - gate.x| <= GATE_HALF` → `state = 'passed'`, `score += GATE_POINTS *
  combo`, and `combo` steps up by one to a cap of `COMBO_MAX` (8).
- otherwise → `state = 'missed'` and `combo` drops back to 1.

A gate is judged exactly once; `state` is what stops it from scoring twice, and
it is also what the renderer uses to colour the flags (blue pending, green
passed, red missed).

### Obstacles

Obstacles are `{ type, x, y, hit }` with three types and axis-aligned boxes:

| Type | Half-width | Half-height | Effect |
|---|---|---|---|
| `tree` | 12 | 14 | crash — a tree is tall, so it catches you in the air too |
| `rock` | 11 | 8 | crash on the ground, harmless while airborne |
| `ramp` | 22 | 9 | launches you into the air; ignored while already airborne |

Collision is a box overlap against the skier's `SKIER_HW` × `SKIER_HH` (9 × 12)
box. An obstacle that has already acted is marked `hit` so it cannot fire twice
on the frames the skier spends overlapping it.

### Jumping and air

`Space` on the ground sets `air = JUMP_AIR` (0.6 s); a ramp sets
`air = RAMP_AIR` (1.15 s). While `air > 0` the skier is airborne: rocks and
ramps are skipped, steering is slower, braking does nothing, and `airTime`
accumulates. On landing, `score += round(airTime * AIR_POINTS_PER_SEC)` (120
points a second) and `airTime` resets. Trees are the one thing a jump cannot
save you from.

### Crashing

Hitting a tree or a rock drops a life, resets `combo` to 1, zeroes `speed`,
`angle` and `air`, and moves the game to `state = 'crashing'` for `CRASH_TIME`
(1.3 s), during which the world is frozen and the skier is drawn as a tumble of
skis and poles. When the timer runs out the game either ends (no lives left) or
returns to `running` with `invuln = INVULN_TIME` (1.2 s) of ignored collisions,
so you are not instantly re-crashed by the obstacle you landed in. The skier
flashes while invulnerable.

### Course generation

The course is generated ahead of the skier from a seeded LCG (`rand()`), so a
test can pin `rngSeed` and get the same mountain every time. A `spawnY` frontier
walks downhill while it is closer than `SPAWN_AHEAD` (820 px) to the skier,
emitting one row each step and then advancing by

```
rowGap = max(ROW_GAP_MIN, ROW_GAP_BASE - distance * ROW_GAP_SHRINK)
```

(130 px thinning to 78 px), which is the second difficulty ramp alongside speed.
A row is a gate with probability `GATE_CHANCE` (0.34) or otherwise one to three
obstacles rolled as 55% tree, 30% rock, 15% ramp at random piste positions. The
first `SPAWN_START` (400 px) of the run is left empty so the start is never
unfair, and everything more than `CULL_BEHIND` (260 px) uphill of the skier is
dropped. Setting `spawnEnabled = false` freezes generation, which is how the
tests get a bare mountain to place single objects on.

## Controls

| Input | Action |
|---|---|
| `←` `→` / `A` `D` | carve left / right |
| `↓` / `S` | snowplough brake |
| `Space` | jump (also starts the game when idle or after a game over) |
| `Enter` | start / restart |
| `P` | pause / resume |

## Code structure

`game.js` is a single classic (non-module) script, matching BurgerTime, Kaboom!
and Snake in this repo: every piece of state is a plain script-scope binding, so
the Playwright specs can read and drive it directly from `page.evaluate` without
an export surface. All motion is expressed per second and advanced through
`step(dt)`, and `requestAnimationFrame` only supplies `dt` and calls `draw()` —
so the tests simulate frames deterministically without waiting on wall-clock
animation.

| Symbol | Role |
|---|---|
| `state` | `'idle' \| 'running' \| 'paused' \| 'crashing' \| 'over'` |
| `skier` | `{ x, y, angle, speed, air, airTime, invuln }` |
| `obstacles`, `gates` | live world objects, culled behind the skier |
| `score`, `best`, `lives`, `combo`, `distance` | run state, `best` in `localStorage` |
| `step(dt)` | the whole simulation: input → motion → spawn → collide → cull → HUD |
| `draw()` | pure rendering, reads state only |
| `startGame()`, `togglePause()`, `crash()` | run lifecycle |
| `addGate(x, y)`, `addObstacle(type, x, y)` | object constructors shared by the spawner and the tests |

Rendering is plain canvas 2D: a snow gradient with drifting speckle tied to
`cameraY` for the sense of motion, a 100 m marker line, piste netting down both
edges, triangular pines, rounded rocks, wedge ramps, flag pairs, and a skier
drawn as a rotated body with a drop shadow that separates while airborne. The
skier also leaves carved tracks: `trail` samples `{ x, y, angle }` every 30 ms
on the ground and the renderer draws two grooves through those points, breaking
the path wherever consecutive samples are more than `TRAIL_BREAK` apart — which
is exactly where the skier was in the air.

## Assumptions

These are the judgement calls made where the brief was open, resolved toward the
simpler reading:

- **Endless, not a timed course.** A slalom could be a fixed course against the
  clock. The simpler and more arcade-like reading is an endless run that gets
  faster, scored on distance, gates and air, ending after three crashes. Lives
  and a personal best fit the rest of the repo.
- **Gates are scored on a line crossing, not a swept box.** The skier is judged
  the first frame past the gate's `y`, using their `x` at that moment, rather
  than intersecting the swept path against the flag poles. At the frame rates
  the game runs at, the difference is under a pixel.
- **Flags are not solid.** Clipping a flag pole does not crash you, it just
  fails the gate. Solid poles punish a near miss twice.
- **Trees catch you in the air.** Jumping is an answer to rocks and a way to
  chain ramp bonuses, not a universal escape.
- **The whole canvas width is the piste.** There is no out-of-bounds; the skier
  is clamped at `EDGE_MARGIN` from each edge so a panicked carve parks you
  against the netting rather than killing the run.
- **Branch naming.** The brief asked for a branch named after the game
  (`ski-slalom`); this session is pinned to the designated development branch
  `claude/compassionate-ramanujan-0m3afk`, so the work is committed there and
  the game name lives in the folder, commit message and PR title instead.
- **Game browser integration.** The game is registered in
  `game-browser/src/assets/games.json` under the existing `Sports` category,
  following the entry shape of the games already listed there.
