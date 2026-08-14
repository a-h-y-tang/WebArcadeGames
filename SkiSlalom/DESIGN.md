# Ski Slalom — Design

## Concept

Ski Slalom is a timed downhill race against the clock. The skier is always
falling down the hill; the only control is **which way the skis point**. Aiming
straight down the fall line is fast but makes the next gate hard to reach;
carving across the hill puts you on line but scrubs speed. Every turn is that
trade, and the clock is the score.

A run is a seeded course of `GATE_COUNT` slalom gates alternating either side of
the centre line, with pine trees scattered in the space between them. Ski
between both poles of a gate to clear it; skip one and it costs `MISS_PENALTY`
seconds. Clip a tree and you go down for `CRASH_TIME` seconds with the clock
still running. Cross the finish line and your time plus penalties is compared
against the best run stored in `localStorage`.

## Mechanics

- **The slope** is a 480×640 view of a course `FINISH_Y` px long (≈ 375 m at the
  HUD's cosmetic `PX_PER_M` scale). The camera keeps the skier pinned at
  `SKIER_SCREEN_Y`, so the world scrolls up past them.
- **Heading.** `skier.heading` is the ski angle in radians, 0 being straight
  down the hill, clamped to ±`MAX_ANGLE` (~66°). A held direction swings the
  skis at `TURN_RATE`; releasing lets them drift back toward the fall line at
  `CENTER_RATE`, so the player steers rather than constantly counter-steers.
- **Speed** chases a target of `MAX_SPEED · cos(heading)` — all of the hill's
  pull when pointed straight down, only 40% of it at full carve — gaining at
  `ACCEL` and scrubbing off at the much larger `DECEL`. Velocity is then
  `(sin h, cos h) · speed`, so a turn buys sideways travel with descent rate.
- **Slope edges.** Below `EDGE_MARGIN` or above `CANVAS_W − EDGE_MARGIN` the
  skier is stopped by deep snow and capped at `EDGE_SPEED`. Running the edge is
  a legal escape from a tree field, just a slow one.
- **Gates** are two poles `2 · GATE_HALF` apart. They are resolved in order the
  moment `skier.y` reaches the pole line: inside the corridor is a pass, outside
  is a miss worth `MISS_PENALTY` seconds. A cleared gate is drawn with a green
  line across it, a missed one is greyed out.
- **Trees** are generated anywhere on the slope except within
  `GATE_HALF + GATE_CLEAR_X` horizontally and `GATE_CLEAR_Y` vertically of a
  gate, so the racing line through the poles is always skiable. Hitting one
  costs `CRASH_TIME` face down; the tree is flattened (`hit = true`) so you
  cannot be pinned by the same trunk twice while you get up.
- **Scoring.** `finalTime() = elapsed + penalty`. The clock stops at the finish
  line; a faster total replaces the record under `ski-slalom-best`.

### Key constants

| Constant | Value | Meaning |
|---|---|---|
| `CANVAS_W` / `CANVAS_H` | 480 / 640 | view size |
| `SKIER_SCREEN_Y` | 200 | where the camera pins the skier |
| `MAX_SPEED` | 430 | px/s straight down the fall line |
| `MAX_ANGLE` | 1.15 | rad, sharpest carve (~66°) |
| `TURN_RATE` / `CENTER_RATE` | 2.8 / 1.8 | rad/s steering in, drifting back |
| `ACCEL` / `DECEL` | 320 / 620 | px/s² gained downhill, scrubbed by turning |
| `EDGE_MARGIN` / `EDGE_SPEED` | 18 / 130 | deep snow line, speed in it |
| `GATE_COUNT` / `GATE_SPACING` | 16 / 300 | gates per course, vertical gap |
| `GATE_HALF` | 46 | half the gap between the poles |
| `MISS_PENALTY` / `CRASH_TIME` | 3 s / 1.2 s | skipped gate, time on the floor |
| `SUB_STEP` | 1/240 s | fixed physics tick |

## Controls

| Key | Action |
|---|---|
| ← / A | Carve left |
| → / D | Carve right |
| Space | Start / restart a run |
| P | Pause / resume |
| R | Restart on a new course |

Releasing both steering keys lets the skis straighten out by themselves.

## Code structure

A single classic (non-module) script, matching Slime Volley, Kaboom and Tetris
in this repo. State lives in plain globals so the Playwright tests can reach it
directly; the mutable ones are declared with `var` so they are visible on
`window` as well as by bare name.

| Area | Functions |
|---|---|
| Course | `mulberry32()`, `buildGates()`, `buildTrees()`, `blocksGate()`, `buildCourse()` |
| Run flow | `startGame(seed)`, `finishRun()`, `togglePause()`, `finalTime()` |
| Simulation | `step(dt)`, `substep(h)`, `resolveGates()`, `hitTree()` |
| Input | `steer(dir)`, key handlers via a `held` map |
| Presentation | `draw()`, `drawGate()`, `drawTree()`, `drawSkier()`, `drawTrail()`, `drawSnow()`, `drawFinish()`, `cameraY()`, `updateHud()` |
| Test hook | `setSkier(x, y)` — put the skier anywhere on the hill, back on their feet |

### Determinism

Two decisions make a run reproducible, which is what lets the tests simulate
whole races rather than poke at frames:

1. **The course comes from a seeded PRNG.** `startGame(seed)` builds gates and
   trees from `mulberry32(seed)`, so the same seed is always the same hill.
   Called with no seed (from the UI) it picks a random one.
2. **`step(dt)` advances fixed `SUB_STEP` sub-steps from an accumulator.** The
   result depends only on the total elapsed time, not the frame rate, and a fast
   skier cannot tunnel past a pole line or through a tree between frames. The
   render loop only clamps `dt`, calls the same `step()` the tests call, and
   draws.

Nothing in the simulation calls `Math.random()`. The drifting snow speckles are
drawn from a positional hash, and the ski tracks are sampled in the render loop,
so neither can perturb a race.

## Testing

`tests/ski-slalom.spec.js` drives the page from `file://` — no server needed —
with 58 tests across course generation, steering and the speed/angle trade,
slope edges, gate scoring, tree crashes, the finish and the record, pause, and
rendering. Two of them race whole courses:

- **The autopilot test** skis seeds 1–5 with a simple lead-based controller
  (aim at where the skier will be in 0.35 s, not where it is) and requires every
  gate on every course to be cleared. It is the guard that says the courses
  generated are actually skiable.
- **The straight-lining test** holds no keys at all and requires the run to
  finish, miss gates, and be penalised for them.

Two things came out of running those rather than from the original sketch:

1. **Trees have to keep clear of gates.** With trees scattered uniformly, a
   generated course could wall off a gate corridor entirely — the autopilot
   would ski into a trunk it had no way around. `GATE_CLEAR_X`/`GATE_CLEAR_Y`
   are the fix, and the "no tree blocks the corridor of a gate" test checks 12
   seeds' worth of courses for it.
2. **Fixtures must pick a tree-free lane.** The test comparing carved speed
   against straight speed originally pinned both runs to the middle of the
   slope, where the straight run kept hitting trees and never reached top speed
   — it was measuring crashes, not angles. Both runs now use the same clear
   lane near the edge, so the ski angle is the only difference between them.

Run them from the repository root:

```powershell
npx playwright test SkiSlalom/tests/
```

## Assumptions

The task description left some things open. Where it did, the simpler reading
was taken and recorded here.

- **Branch name.** The task asks for a branch named after the game
  (`ski-slalom`), but this session is also configured with a fixed development
  branch, `claude/loving-euler-1fne7s`, and told never to push elsewhere. The
  configured branch wins; the game name is carried by the folder, the commit and
  the PR title instead. (Slime Volley made the same call.)
- **Turning is the only input.** No tuck, no jump, no poling. One axis of
  control keeps the game readable and makes the speed-versus-line trade the
  whole of the skill.
- **Poles are not solid.** Real slalom poles are hinged and get knocked aside;
  here they have no collision at all, so the only way to lose time at a gate is
  to miss it. Otherwise a clipped pole would be both a crash and a miss, which
  punishes the same mistake twice.
- **A gate is scored on the pole line.** Passing is judged by the skier's x at
  the moment they reach the gate's y, not by the whole path through it. With
  sub-steps of 1/240 s the difference is under a pixel.
- **A crash does not reset the run.** It costs `CRASH_TIME` with the clock
  running and nothing else — no lost gates, no restart — so a bad line stays
  recoverable.
- **Records are per-browser, not per-course.** One best time is kept, across all
  seeds, in `localStorage`. Courses vary a little in difficulty, so this is a
  personal-best board rather than a leaderboard.
- **The metre and km/h readouts are cosmetic.** `PX_PER_M` only scales what the
  HUD prints; the simulation is entirely in pixels and seconds.
- **`setSkier` is a test hook.** It exists so tests can construct a situation
  directly, and it puts the skier back on their feet since "be here" means "be
  skiing here". Nothing in the game itself calls it.
