# Mini Golf — Design

## Concept

Mini Golf is a top-down putting game. You line up a shot from the ball,
choose a direction and a power, and putt across a small walled green toward
the cup. The ball rolls, slows under friction, bounces off the walls and off
wooden obstacles, and drops into the cup when it arrives slowly enough. The
course is a short sequence of holes; you play them in order and your goal is
to sink them all in as few strokes as possible. A lower total is a better
score.

## Mechanics

- **Ball** — a small disc with a position (`x`, `y`) and velocity
  (`vx`, `vy`). While it is moving it rolls under **friction**: a constant
  deceleration bleeds off speed along the direction of travel until the ball
  drops below a stop threshold and halts. A `moving` flag tracks whether the
  ball is in motion.
- **Aiming** — while the ball is at rest you set an aim **angle** and a
  **power** (clamped between `MIN_POWER` and `MAX_POWER`). A dashed guide
  line on the canvas shows the current direction and relative strength.
- **Putting** — `shoot()` converts the current aim into a velocity
  (`power` along `angle`), sets the ball moving and counts one **stroke**
  (added to both the current-hole strokes and the course total). You cannot
  putt again until the ball has come to rest.
- **Walls & obstacles** — the ball bounces off the four boundary walls and
  off any rectangular wooden obstacle on the hole. Collisions use a
  circle-versus-rectangle test: the ball is pushed back out of the wall and
  its velocity is reflected about the contact normal, keeping a fraction
  (`WALL_RESTITUTION`) of its speed.
- **Sinking** — when the ball is over the cup (within the cup radius) **and**
  moving slower than `CAPTURE_SPEED`, it drops in. Arrive too fast and the
  ball simply rolls over the lip and carries on, so a wild putt won't sink.
- **Holes & the course** — sinking a hole advances to the next tee (current
  strokes reset, the running total is kept). Sinking the **last** hole wins
  the course.
- **Scoring / best** — the score is the total number of strokes across the
  whole course, compared against the course **par**. The best (lowest) total
  is persisted to `localStorage` under the key `minigolf-best`; because lower
  is better, a new total only replaces the best when it is smaller.

## Controls

- **Mouse** — press on the green and **drag back** from the ball to aim and
  set power (a slingshot: pull back further for a harder putt, release to
  fire).
- **← / →** or **A / D** — rotate the aim left / right
- **↑ / ↓** or **W / S** — increase / decrease power
- **Space** — putt (also starts the game from the title / win screen and
  resumes from pause)
- **P** — pause / resume
- **Start button** — start (or restart) the course

## State machine

`idle → running ⇄ paused → won → running …`

- `idle` — title screen, overlay visible, the ball resting on the first tee.
- `running` — you are playing; input (aim / putt) is active while the ball is
  at rest and physics runs while it rolls.
- `paused` — physics frozen, overlay shows "Paused".
- `won` — the final hole is sunk; overlay shows the total and how it compares
  to par.

## Testable surface

To make the game deterministic and easy to drive from Playwright, the
following are exposed as globals, mirroring the convention established by the
other games here:

- State: `state`, `holeIndex`, `strokes`, `totalStrokes`, `par`, `totalPar`,
  `best`
- Objects: `ball`, `target` (the cup), `walls`, `aim`, `COURSE`
- Constants: `WIDTH`, `HEIGHT`, `BALL_R`, `HOLE_R`, `FRICTION`, `STOP_SPEED`,
  `CAPTURE_SPEED`, `WALL_RESTITUTION`, `MIN_POWER`, `MAX_POWER`
- Functions: `startGame()`, `step(dtMs)`, `shoot()`, `setAim(a)`,
  `setPower(p)`, `aimLeft()`, `aimRight()`, `powerUp()`, `powerDown()`,
  `loadHole(i)`

`step(dtMs)` advances all physics (friction, integration, boundary and
obstacle bounces, cup capture and the stop check) by an explicit number of
milliseconds without relying on `requestAnimationFrame` timing, so every
behaviour can be tested deterministically. Because the courses are fixed and
nothing uses `Math.random`, the whole game is reproducible.

## Assumptions

- **Canvas size 500×500.** Kept identical to the other arcade games for
  visual consistency; a square green suits a top-down putting view.
- **Simpler interpretations, chosen deliberately:**
  - **Fixed hand-authored courses (3 holes).** No random or procedurally
    generated layouts — a short, deterministic course keeps the scope focused
    and the game fully reproducible. More holes can be added to `COURSE`
    without touching the engine.
  - **Rectangular obstacles only.** Bumpers, ramps, slopes, water hazards and
    sand are omitted. (Noted as a known omission, not an oversight.)
  - **No out-of-bounds / penalty strokes.** The boundary walls simply bounce
    the ball back in, so a putt can never leave the green.
  - **Constant friction everywhere.** The whole green rolls the same; there
    are no fast/slow surfaces.
- **A putt cannot sink at speed.** Requiring the ball to be under
  `CAPTURE_SPEED` to drop in models a real cup lip and prevents a ball that
  merely clips the hole at pace from counting.
- **Lower total is better.** The best score is the *minimum* total strokes,
  so `localStorage` is only overwritten when the new total is smaller.
- **Endless replay, no failure state.** There is no way to "lose" — you
  always eventually sink each hole — so the only terminal state is winning
  the course, after which you can replay to beat your best.
