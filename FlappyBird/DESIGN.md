# Flappy Bird — Design

## Concept

A single-input side-scroller. You control a bird that is constantly pulled down
by gravity. Tapping flap gives it an upward impulse. The world scrolls past as a
series of vertical pipes with gaps; steer the bird through each gap without
touching a pipe, the ceiling clamp, or the ground. Every pipe you clear is one
point. One touch ends the run.

## Mechanics

- **Gravity:** every fixed physics tick, a constant downward acceleration is
  added to the bird's vertical velocity, then the velocity is added to the bird's
  `y`. This produces smooth accelerating falls.
- **Flap:** a flap input sets the bird's vertical velocity to a fixed negative
  (upward) value, overriding the accumulated fall. Repeated flaps let the bird
  climb.
- **Ceiling:** the top of the playfield is a soft clamp — the bird cannot leave
  the top of the screen (`y` and velocity are pinned at the top edge) rather than
  dying there, matching the feel of the original.
- **Pipes:** pipes are pairs of rectangles (top + bottom) sharing an `x` and a
  vertical `gapY` (top of the gap). They spawn just off the right edge and scroll
  left at a constant speed. Off-screen pipes are pruned. A new pipe spawns once
  the rightmost pipe has moved a fixed spacing in from the right edge, keeping the
  horizontal cadence roughly constant.
- **Scoring:** a pipe is scored once, the moment its right edge passes the bird's
  fixed `x`. Score increments by one and updates the HUD.
- **Collision / game over:** the run ends when the bird's bounding circle
  overlaps a pipe rectangle, or when the bird reaches the ground strip at the
  bottom.
- **Best score:** the high score persists in `localStorage` under
  `flappy-best` and is restored on load.

### Physics loop

The loop is timestamp-driven (`requestAnimationFrame`) with a **fixed timestep
accumulator**: real elapsed time is consumed in fixed `TICK_MS` chunks, each
running one deterministic `tick()`. This keeps the simulation frame-rate
independent and makes physics reproducible for tests. A per-frame step cap
prevents a spiral of death after a long stall (e.g. a paused tab).

## Controls

| Input | Action |
|---|---|
| Space / ↑ / W / click canvas | Flap (also starts / restarts the game) |
| Start button | Start / restart |
| P | Pause / resume |

## State machine

`idle → running → over`, plus a `paused` side-state reachable from `running`.
The overlay is shown in every state except `running`.

## Testable surface

For deterministic Playwright tests, the game exposes its live state as page
globals (`bird`, `pipes`, `score`, `best`, `state`) and the pure helpers
(`startGame`, `endGame`, `flap`, constants). Tests drive the game by pressing
keys and by writing directly into these globals (e.g. positioning a pipe on top
of the bird to force a collision), mirroring the pattern used by the Snake tests
in this repo.

## Assumptions

- **DESIGN.md casing:** the task asked for `DESIGN.md`; the repo's existing games
  use lowercase `design.md`. This file is the single design document for the game
  and satisfies both the task instruction and the repo's "each game has a design
  doc" convention.
- **No pause in the classic game:** the original Flappy Bird has no pause. A `P`
  pause/resume is included anyway for consistency with the other games in this
  repo (Snake, Tetris, Breakout).
- **Portrait canvas:** a 400×600 portrait canvas was chosen (vs. the repo's
  landscape/square games) because it suits vertical flappy gameplay. Simpler than
  making the field responsive.
- **Ceiling is a clamp, not death:** many Flappy clones let the bird bonk the top
  harmlessly; only the ground and pipes kill. Chosen as the simpler, more
  forgiving interpretation.
- **Circle-vs-rect collision** uses the bird's bounding box against pipe
  rectangles — visually indistinguishable at this size and simpler than exact
  circle math.
- **Random gap placement** uses `Math.random()`; tests never assert on random
  values, only on deterministic behavior driven through the exposed globals.
