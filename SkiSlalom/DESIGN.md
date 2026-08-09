# Ski Slalom — Design

## Concept

A downhill slalom racer on a single HTML5 canvas. The skier drops into a
never-ending sequence of *runs*. Every run is a fixed-length course of slalom
gates planted down a snowy piste and scattered with pine trees. Carve through
every gate, keep off the trees, and cross the finish line before par time; clear
a run and the next one starts immediately, a little narrower and a lot more
crowded. Three crashes and the run is over.

The hook is the tension between the two things that make you fast — tucking for
top speed and running a tight line — and the two things that punish you: a gate
missed at speed costs two seconds, and a tree costs a life plus a second on the
ground.

## Mechanics

### The hill

The world is a vertical strip 600 units wide (the canvas width) and
`courseLength()` units tall. The skier is always drawn at a fixed screen `y`
(`SKIER_SCREEN_Y`) and the world scrolls past them, so the camera is just
`worldTop = skier.y - SKIER_SCREEN_Y`.

A course is `GATES_PER_RUN` (12) gates spaced `GATE_SPACING` (260) apart, with a
`RUN_OUT` of 220 after the last gate before the finish banner — 3320 units in
all.

### Course generation

`buildCourse(seed)` builds a hill from a seeded `mulberry32` PRNG, using the run
number as the seed. That means run 3 is always the same hill, courses are
reproducible in tests, and difficulty can be a pure function of the seed:

- **Gate width** — `gateHalf(run)` starts at 62 units of half-width and loses 5
  per run, with a floor of `GATE_MIN_HALF` (34).
- **Tree count** — `treeCount(run)` starts at 26 and gains 9 per run.
- Gates alternate sides of the fall line (even gates left of centre, odd gates
  right), which is what gives a slalom its rhythm.
- Trees are rejected — and re-rolled, up to 40 attempts — if they would stand
  in a gate opening, sit on top of another tree, or land in the first 160 units
  of the course. Every generated course is therefore skiable.

### Skiing

All motion is per second and advanced by `step(dt)`:

- Speed climbs toward a target at `ACCEL` and falls toward it at `BRAKE`.
- The target is `BASE_MAX` (300), or `TUCK_MAX` (430) while tucking, minus
  `STEER_DRAG` (70) whenever the skier is carving. Straight-lining is fast;
  turning costs you.
- Carving moves the skier sideways at `STEER_SPEED` (230), clamped to the piste.

### Gates

A gate is scored on the frame the skier's `y` crosses the gate line. Inside the
opening (`|skier.x - gate.x| <= gate.half`) it turns green and pays
`GATE_POINTS + (run - 1) * GATE_RUN_BONUS`; outside it, it is crossed out and
`MISS_PENALTY` (2s) goes on the clock. Each gate resolves once — its `state`
moves from `ahead` to `passed`/`missed` and is never re-evaluated.

### Trees and crashes

Collision is a cheap box overlap of the skier's radius against the trunk radius.
A hit marks the tree (so one tree can only ever cost you once), stops the skier
dead for `CRASH_TIME` (1.1s) — during which they cannot steer or move — and
costs a life. At zero lives the game ends.

### Finishing

Crossing `courseLength()` calls `finishRun()`: it pays `FINISH_BONUS` (500), a
`timeBonus()` worth 25 points per second saved against par, and a `CLEAN_BONUS`
(300) if no gate was missed. Then the run counter goes up, a bonus life is
awarded up to `MAX_LIVES` (5), the clock resets, and a fresh course is built
with the skier back at the top.

Par time is `courseLength() / BASE_MAX + PAR_SLACK` — about 14.1s, i.e. slightly
more than a perfect straight-line descent at cruising speed, so beating par
means tucking somewhere.

### Scoring

Score accumulates across runs and only resets on a new game. The best score is
persisted to `localStorage` under `ski-slalom-best`.

## Controls

| Input | Action |
|---|---|
| <kbd>←</kbd> / <kbd>→</kbd> (or <kbd>A</kbd>/<kbd>D</kbd>) | carve left / right |
| <kbd>↓</kbd> (or <kbd>S</kbd>) | tuck for extra top speed |
| Mouse move | steer toward the pointer |
| Mouse button | tuck |
| <kbd>Space</kbd> | start / restart |
| <kbd>P</kbd> | pause / resume |

Keyboard input always wins: pressing a steering key drops out of pointer
steering until the mouse moves again.

## Code layout

| File | Contents |
|---|---|
| `index.html` | HUD, canvas, overlay, help line |
| `style.css` | Alpine-blue panel styling shared in spirit with the other games |
| `game.js` | All game state and logic, as top-level globals |
| `tests/skislalom.spec.js` | 61 Playwright tests |

`game.js` is a classic (non-module) script, matching Kaboom, Dino Run and Snake
in this repo, so the tests can reach state and helpers as plain globals:
`state`, `score`, `run`, `lives`, `skier`, `gates`, `trees`, `step(dt)`,
`steer(dir)`, `setTuck(on)`, `buildCourse(seed)`, `nextGate()`, `timeBonus(t)`
and so on.

The simulation is deliberately split from the render loop. `frame()` only
computes `dt`, applies pointer steering, then calls `step(dt)` and `draw()` —
so a test can call `step(0.016)` in a loop and get exactly the same physics
without touching `requestAnimationFrame` or wall-clock time.

Rendering is layered back-to-front: snow gradient, a deterministic snow texture
hashed from world coordinates (so it stays put as the world scrolls), the orange
course netting, ski tracks, the finish banner, gates, trees, snow spray, the
skier, and a run-progress bar down the right edge.

## Testing

Written test-first with `@playwright/test`, run from the repo root:

```powershell
npx playwright test SkiSlalom/tests/
```

The suite covers initial state, starting, course generation (determinism,
spacing, difficulty scaling, no tree ever blocking a gate), movement and speed
caps, gate scoring and misses, tree crashes and recovery, run progression and
bonuses, scoring/best persistence, and pause/restart.

## Assumptions

Recorded per the brief; each is the simpler reading of an ambiguous point.

- **Branch name.** The task asked for a branch named after the game
  (`ski-slalom`), but this session is pinned to the designated branch
  `claude/loving-euler-jtfvh8`, and pushing elsewhere is not permitted here. The
  work is on the designated branch; the game name is carried by the folder,
  commit and PR title instead.
- **"Novel" game.** Read as "a genre not already in the repo". Nothing in the
  repo is a downhill/skiing game, so this is the pick.
- **Endless, not a fixed campaign.** Runs continue for as long as the skier has
  lives, rather than ending at a fixed number of courses. It keeps the loop
  simple and gives the score something to grow against.
- **Score accumulates across runs; the clock does not.** The clock is per-run so
  the time bonus is comparable run to run.
- **A crash costs a life but never ends the run.** The skier gets up where they
  fell rather than restarting the course — losing lives (and 1.1s each) is
  punishment enough.
- **Time penalties are added to the clock, not the score.** They cost points
  only indirectly, through a smaller finish-time bonus.
- **One collision shape.** Trees use a square-ish overlap test rather than true
  circle distance; at these sizes and speeds the difference is invisible, and it
  keeps the collision code trivial.
- **No sound.** Consistent with the rest of the repo.
- **Canvas is a fixed 600×400**, matching the other games in the repo, rather
  than being responsive.
