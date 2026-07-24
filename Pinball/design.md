# Pinball — Design

## Concept

A single-file, canvas implementation of a classic **Pinball** table. A steel
ball is launched from a spring plunger up the right-hand lane, drops into a
play field full of scoring bumpers, and the player keeps it alive with two
flippers at the bottom. Let the ball fall through the drain between the
flippers and you lose it. You start with **3 balls**; the game ends when the
last ball drains. Score as many points as you can.

## The table

The table is a `400 × 620` portrait canvas. Coordinates use canvas
convention: `x` increases rightward, `y` increases **downward**, so a negative
`vy` means the ball is travelling **up**.

Fixed geometry (all in canvas pixels):

- **Outer walls** — a top wall, a left wall, and a full-height right wall.
- **Angled lower guides** — two diagonal walls funnel a falling ball inward
  toward the flippers so it can only drain through the centre gap.
- **Plunger lane** — a narrow channel on the right, separated from the play
  field by a vertical **divider** wall that stops below the top so a launched
  ball curves left into the field.
- **Bumpers** — three round bumpers that bounce the ball and award points.
- **Flippers** — two line-segment flippers pivoting near the bottom, guarding
  the central **drain gap**.

## Physics

A fixed-form Euler integrator advances the simulation. `step(dt)` (seconds):

1. Adds gravity to `vy` (skipped while the ball is *held* in the plunger).
2. Integrates position: `x += vx·dt`, `y += vy·dt`.
3. Resolves collisions against every static wall segment, then the bumpers,
   then the flippers.
4. Clamps speed to `MAX_SPEED` to avoid tunnelling.
5. Checks the drain line — a ball that falls past it costs a ball.

### Segment collisions

`collideSegment(seg, restitution, kick)` finds the closest point on the
segment to the ball. If the ball is within its radius **and** moving into the
segment (velocity · surface-normal `< 0`), the velocity is reflected across the
normal with the given `restitution`, the ball is pushed back out of overlap,
and an optional `kick` impulse is added along the normal. Walls use a mild
restitution; flippers use a livelier one plus a **kick when raised**, which is
how the player powers the ball back up the table.

### Bumper collisions

`collideBumper(b)` treats the bumper as a circle. On contact the ball reflects
off the centre-to-centre normal, gets a fixed **bumper kick**, and `b.value`
is added to the score.

## Controls

- **Space / Up arrow** — launch the ball from the plunger (only while a ball is
  held in the lane).
- **Left arrow / `Z` / `A`** — raise the **left** flipper (while held down).
- **Right arrow / `/` / `L`** — raise the **right** flipper (while held down).
- Releasing a flipper key lets it fall back to rest.
- Click **Start / Play Again**, or press any key, to begin or restart.

## State, scoring, lives

- `state` is `ready` → `playing` → `over`.
- `score` accumulates from bumper hits.
- `ballsLeft` starts at **3** and counts the balls you still have to play
  (including the one in play). Draining decrements it; when it reaches 0 the
  game is over.
- `drainBall()` decrements `ballsLeft`, then either resets the ball to the
  plunger (held) or ends the game.
- `best` (persisted to `localStorage` under `pinball-best`) tracks the highest
  score achieved — higher is better.

## Exposed API (for tests)

The core state and logic are top-level globals so the Playwright suite can
drive them directly: `ball`, `bumpers`, `leftFlipper`, `rightFlipper`,
`walls`, `state`, `score`, `ballsLeft`, `GRAVITY`, plus `startGame`,
`resetBall`, `launchBall`, `step`, `pressLeft/releaseLeft`,
`pressRight/releaseRight`, `collideSegment`, `collideBumper`, `drainBall`,
`checkGameEnd`, `endGame`, and `updateHud`.

## Rendering

Pure Canvas 2D: a dark table with glowing round bumpers, a metallic gradient
ball with a highlight, angled guide walls, and two flippers drawn as rounded
capsules that visibly swing up when raised. A HUD shows score, balls left, and
best. An overlay handles start / game-over.

## Assumptions

Choices that resolve ambiguities toward the simplest faithful interpretation:

1. **File naming.** The repo convention is a lowercase `design.md` per game, so
   this file is `design.md` despite the task brief saying `DESIGN.md`. The
   Assumptions section lives here.
2. **Arcade physics, not a rigid-body simulator.** A single circular ball
   against static segments and circles, resolved with reflection + restitution,
   is enough to feel like pinball without a full physics engine. Determinism
   (no randomness anywhere) keeps the game testable.
3. **Three balls, single table.** No multiball, tilt, ramps, or multipliers —
   one classic table with bumpers and flippers.
4. **Flippers snap** between their rest and raised angles rather than animating
   through intermediate positions during simulation; the kick they impart is
   applied while raised. This keeps collision behaviour deterministic.
5. **Best = highest score** persisted in `localStorage`.
6. **The plunger launches at a fixed strength** (no variable-power charge), the
   simpler interpretation.
