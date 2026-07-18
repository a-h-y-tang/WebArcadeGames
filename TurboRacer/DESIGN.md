# Turbo Racer — Design

## Concept

Turbo Racer is a top-down endless racing / dodging arcade game. You drive a car
up a four-lane highway that scrolls beneath you while slower traffic streams
down from the top. Steer left and right to weave through the gaps. The longer
you survive, the faster the road scrolls and the higher your score climbs. One
collision ends the run.

It fills a niche not yet covered by the repo's other games: a continuous,
reflex-based "avoid the obstacles" racer with steadily ramping difficulty.

## Mechanics

- **The road** occupies the centre of the 400×600 canvas (`ROAD_LEFT`..
  `ROAD_RIGHT`), flanked by grass verges. It is divided into `LANES` (4) equal
  lanes. Dashed lane markings scroll downward to sell the sense of speed.
- **The player car** sits near the bottom of the screen. It only moves
  horizontally (left/right); vertical motion is faked by scrolling the world.
  Its x-position is clamped to the road.
- **Traffic** spawns at the top, one car at a time, in a randomly chosen lane.
  Each enemy car drifts downward at the road's scroll speed plus a small
  per-car offset, so faster cars appear to be overtaken. Cars that leave the
  bottom of the screen are recycled.
- **Difficulty ramp**: the scroll speed grows with distance travelled, capped at
  `MAX_SCROLL`. As speed rises, the spawn interval shrinks, so traffic gets
  denser as well as faster.
- **Scoring**: the score is the distance travelled (`Math.floor(distance)`),
  incremented every frame in proportion to the current scroll speed. The best
  score is persisted to `localStorage`.
- **Collision** is axis-aligned bounding-box overlap between the player car and
  any enemy car. Any overlap ends the game.

### Frame-rate independence

Like the other games in this repo, all motion is expressed in
pixels-per-millisecond and integrated by a single `step(dt)` function. The
render loop calls `step` with the real elapsed time; the Playwright tests call
`step` directly with fixed `dt` values, so the simulation is fully
deterministic and testable without relying on wall-clock timing.

### Seeded RNG

Lane selection and spawn-interval jitter use a self-contained `mulberry32`
seeded RNG (`seedRng`/`rand`), reseeded at the start of every game. This keeps
traffic patterns reproducible for tests.

## Controls

| Input | Action |
|---|---|
| ← / A | Steer left |
| → / D | Steer right |
| Space / ↑ / any steer key | Start the game (from the title or game-over screen) |
| P | Pause / resume |

A **Start** button on the overlay is provided for pointer users.

## States

`idle` → `running` → `gameover`, with `paused` reachable from `running`. The
overlay is visible in every state except `running`.

## Assumptions

These choices were made where the brief was open-ended; the simpler option was
taken each time:

- **Free horizontal steering** (clamped to the road) rather than discrete
  lane-snapping — smoother and simpler to reason about for collisions.
- **One enemy spawned per spawn event**, never a full row, so a survivable gap
  always exists; the game can't create an unavoidable wall.
- **Distance-based scoring** (1 point ≈ 1 unit of distance) rather than
  counting overtaken cars — a single accumulator is simpler and monotonic.
- **Endless mode only** — there are no discrete levels or a win state; the goal
  is a high score.
- **No audio** — consistent with the repo's other games and keeps tests
  headless-friendly.
- Canvas is a fixed **400×600**, matching the portrait games in the repo.

## Files

| File | Purpose |
|---|---|
| `index.html` | Markup: canvas, HUD, overlay, controls hint |
| `style.css` | Layout and theming |
| `game.js` | All game logic: state, `step`, rendering, input |
| `tests/turboracer.spec.js` | Playwright test suite |
