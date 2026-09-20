# Alpine Ski — Design

## Game concept

A downhill slalom run. The camera looks down the mountain from above and behind,
the slope scrolls up past you, and you carve left and right to thread a course of
slalom gates while dodging pines, rocks and moguls. Tuck for speed, snowplough to
scrub it off, and hit the snow ramps to fly over whatever is in the way.

Three courses, each longer, narrower and busier than the last. Each course has a
clock: gates you clear are points, gates you miss cost you seconds, and a crash
costs both. Clear the course before the clock runs out and the seconds you saved
are converted into a time bonus. Clear all three and you have won the mountain.

Nothing else in this repo is a downhill-racing game — the existing racers
(`RoadRacer`, `TurboRacer`) are road games with lane traffic and no carving
model, and the vertical scrollers (`DoodleJump`, `MoonPatrol`) are platformers.
The "steer by leaning into the fall line, trade angle for speed" mechanic is new
here.

## World model

The world is one column of snow as wide as the canvas. The skier has a *world*
`y` that only ever increases; the camera is simply `skier.y - SKIER_SCREEN_Y`, so
the skier is drawn at a fixed height on screen and everything else scrolls past.

| Constant | Value | Meaning |
|---|---|---|
| `CANVAS_W` | 600 px | canvas / slope width |
| `CANVAS_H` | 420 px | canvas height |
| `SKIER_SCREEN_Y` | 150 px | where the skier is drawn; the rest scrolls |
| `EDGE_MARGIN` | 26 px | snow banks; the skier is clamped inside them |
| `SKIER_RADIUS` | 9 px | collision radius |
| `START_X` | 300 px | spawn, centre of the slope |

## Physics

The skier is a point with a heading `angle`, measured in radians away from the
fall line (straight down the hill). Negative is left, positive is right, and the
heading is clamped to `±MAX_ANGLE` (1.1 rad ≈ 63°).

```
angle  += steer * STEER_RATE * dt          (STEER_RATE is lower in the air)
target  = modeSpeed * (1 - EDGE_DRAG * |sin angle|)
speed  += (target - speed) * min(1, ACCEL * dt)
x      += speed * sin(angle) * dt
y      += speed * cos(angle) * dt
```

`modeSpeed` is `TUCK_SPEED` while ↓ is held, `BRAKE_SPEED` while ↑ is held and
`BASE_SPEED` otherwise. The `EDGE_DRAG` term is the whole game in one line: the
harder you carve across the hill, the slower you go, so the fast line is the
straight one and every gate is a decision about how much speed to spend.

| Constant | Value |
|---|---|
| `BASE_SPEED` | 175 px/s |
| `TUCK_SPEED` | 260 px/s |
| `BRAKE_SPEED` | 70 px/s |
| `EDGE_DRAG` | 0.55 |
| `ACCEL` | 1.9 /s |
| `STEER_RATE` | 2.6 rad/s (`AIR_STEER_RATE` 0.9 in the air) |
| `MAX_ANGLE` | 1.1 rad |

## Course generation

Courses are generated from a seeded PRNG (`mulberry32`) keyed on the level, so
course *n* is always the same course — that makes the game fair to replay and the
tests reproducible.

Each course is built top to bottom:

- **Gates** every `GATE_SPACING` (240 px) from `FIRST_GATE_Y`, alternating
  left-of-centre and right-of-centre so the course zig-zags. A gate sits 46–142 px
  off the fall line — far enough to force a real turn, close enough that the
  turn does not cost the whole clock. Gate width starts at 116 px and narrows by
  12 px per level.
- **Obstacles** (pines and rocks) scattered between the gates. A candidate is
  discarded if it lands inside a gate's corridor (within `GATE_CLEARANCE` of the
  segment a skier must fly through) so no course is impossible.
- **Ramps** placed sparsely, also kept out of gate corridors.

| Level | Length | Gate width | Obstacle density | Time limit |
|---|---|---|---|---|
| 1 | 3600 px | 116 px | 0.6 | 50 s |
| 2 | 4400 px | 104 px | 0.9 | 57 s |
| 3 | 5200 px | 92 px | 1.2 | 64 s |

The limits were set by simulation, not by guesswork: a scripted autopilot that
aims at the next gate and brakes for trees clears the three courses in 30.8 s,
42.1 s and 56.8 s, which leaves a human roughly a 15–35 % margin.

## Rules

- **Gates.** Crossing a gate's line inside the flags clears it: `GATE_POINTS`
  (100) × your streak multiplier, capped at `MAX_MULTIPLIER` (5). Crossing it
  outside the flags is a miss: the streak resets and `MISS_PENALTY` (3 s) comes
  straight off the clock.
- **Crashes.** Touching a pine or a rock stops you dead for `CRASH_TIME` (1.1 s),
  resets the streak and resets your speed to zero. You cannot steer while down.
- **Ramps.** Crossing a ramp launches you; while airborne you pass over obstacles
  and gates still count, but steering is weak. Landing pays `AIR_POINTS` (120)
  per second of air.
- **The clock.** Each course starts with its time limit and counts down. Zero is
  game over. Crossing the finish line banks `FINISH_POINTS` (500) plus
  `TIME_BONUS` (25) per second left on the clock.
- **Best score** is kept in `localStorage` under `alpine-ski-best`.

## Controls

| Key | Action |
|---|---|
| ← / → (or A / D) | Carve left / right |
| ↓ (or S) | Tuck — faster, but you still carve slowly |
| ↑ (or W) | Snowplough — brake hard |
| Space | Start, advance to the next course, or restart |
| P / Esc | Pause / resume |

The **Start** button does the same thing as Space.

## Code shape

`game.js` is a single classic (non-module) script, matching Lode Runner, Tetris
and the rest of the repo: state lives in plain globals so the Playwright tests
can read and poke it directly through `page.evaluate`.

The simulation is one pure-ish function, `step(dt)`, called by the
`requestAnimationFrame` loop in real play. Tests call `setAutoStep(false)` and
drive `step(dt)` themselves, so nothing in the suite depends on wall-clock time.

Ordering inside `step(dt)` matters and is fixed:

1. tick the crash timer (and return early while the skier is down),
2. steering and speed,
3. integrate position, clamp to the slope,
4. air timer / landing payout,
5. ramp crossings, gate crossings, obstacle collisions — all against the segment
   from the previous `y` to the new one, so nothing is tunnelled through at speed,
6. the finish line, then the clock — crossing the line in the same frame the
   clock would expire counts as a finish, which is the reading that favours the
   player and keeps the finish bonus arithmetic exact.

Drawing (`draw()`) never mutates simulation state; the particles are decorative
and updated separately, so a test that steps the simulation 500 times is not
also allocating snow spray.

## Assumptions

These were judgement calls made while building; the simpler reading won each time.

- **Branch name.** The task asked for a branch named after the game
  (`alpine-ski`), but this session's standing instruction is to develop and push
  on `claude/compassionate-ramanujan-vl91tm`. The standing instruction wins, so
  the work is on that branch; the game folder and PR are named for the game.
- **The slope is exactly as wide as the canvas.** There is no horizontal camera
  scroll; running into the snow bank at the edge clamps you rather than crashing
  you, which keeps the edge from being a hidden instant-death line.
- **A miss costs time, not points.** Deducting points could take the score
  negative and needs clamping rules; taking seconds off the clock is one number
  and is immediately legible in the HUD.
- **Gates are lines, not solid poles.** You can pass through the flag itself —
  hitting a slalom pole in a real race is legal. Only pines and rocks crash you.
- **One crash model.** Every obstacle crashes the same way (stop, 1.1 s, streak
  lost); there are no lives and no damage model. Time pressure is the only
  currency the player loses.
- **Courses are fixed, not endless.** Three seeded courses with a finish line
  make "you won" a real state, and make the tests deterministic.
- **Airborne means invulnerable.** Flying over a pine is the ramp's reward.
  Landing is automatic — there is no landing-angle failure case.
- **Game browser registration stops at `games.json`.** The game is added to
  `game-browser/src/assets/games.json` in the same shape as every other entry.
  The browser's own e2e spec asserts a hard-coded 105 game cards, but
  `games.json` already held 116 games before this one, so that expectation was
  stale before this change and fixing it is a separate job from adding a game.
