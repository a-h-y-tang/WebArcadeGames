# Peg Blast — Design

## Concept

Peg Blast is a single-screen aim-and-drop physics game in the spirit of
Peggle / pachinko. A cannon sits at the top of the board; below it hangs a
field of pegs. You aim, fire a ball, and watch it ricochet down through the
pegs under gravity. Every peg the ball touches lights up; **orange** pegs are
the targets. Clear every orange peg on the board to finish the level.

The tension comes from the fact that you cannot steer the ball once it is
fired — a shot is a single decision, and the board rearranges itself as pegs
disappear. A moving bucket at the bottom of the board catches balls that make
it all the way down, awarding a free ball, so a lucky drop can extend a run
that looked finished.

Nothing else in this repo plays like it: Pinball is flipper-driven, Kaboom is
a catch game, Marble Spiral is a track shooter. Peg Blast is a ballistic
one-shot-at-a-time clearing game.

## Board

- Canvas is 640 × 720 (fixed size, no scaling).
- The cannon is fixed at the top-centre of the board and only rotates.
- The peg field occupies the middle of the board, well clear of both the
  cannon and the bucket.
- The bucket slides left and right along the bottom of the board at a
  constant speed, reversing at the walls.

## Mechanics

### Shooting

- Aim is a single angle, `aimAngle`, measured in radians from straight down:
  `0` fires vertically, negative aims left, positive aims right. It is clamped
  to ±75° so the ball is always launched downward.
- Firing costs one ball and gives the ball a fixed launch speed along the aim
  direction. Only one ball is in play at a time.
- A shot ends when the ball falls off the bottom of the board, is caught by
  the bucket, or hits the shot time limit (a safety valve so a ball that gets
  wedged can never freeze the game).

### Physics

- Gravity accelerates the ball downward every frame. The simulation is
  advanced by `step(dt)` in fixed sub-steps (1/240 s) so behaviour does not
  depend on frame rate, and tests can drive it deterministically.
- Peg collisions are resolved as circle-vs-circle: the ball is pushed out to
  exactly touching, then its velocity is reflected about the contact normal
  with a restitution of 0.72. Because penetration is resolved every sub-step,
  the ball is never left inside a peg.
- Walls and the ceiling bounce with a slightly higher restitution (0.85). The
  ball's speed is capped so a chain of lucky bounces cannot fling it wildly.

### Pegs and scoring

- Pegs come in two kinds: **blue** (10 points) and **orange** (100 points).
  Every level contains 12 orange pegs, chosen from the layout by a seeded
  shuffle.
- Touching a peg scores it immediately and lights it up, but the peg is not
  removed until the shot ends — so the ball can keep bouncing off pegs it has
  already scored, exactly like the games this borrows from.
- A score multiplier rises as the level's orange pegs are cleared: ×1, then
  ×2 at 4 oranges, ×3 at 8, ×5 at 11, and ×10 when the last one falls. This
  rewards saving a cluster of oranges for one big shot.
- Catching the ball in the bucket awards a free ball (the ball count goes
  back up by one).

### Levels

- Each level starts with 10 balls and a fresh layout. Three layouts —
  **grid**, **diamond** and **arch** — cycle as the level number rises.
- Clearing every orange peg finishes the level and awards a 500-point bonus
  per ball still in hand.
- Running out of balls with orange pegs still standing ends the game. The best
  score is kept in `localStorage` under `peg-blast-best`.

## Controls

| Input | Action |
|---|---|
| `←` / `→` (or `A` / `D`) | Swing the cannon |
| Mouse move over the board | Aim at the pointer |
| `Space` | Start / fire / advance to the next level |
| Click on the board | Fire |
| `P` | Pause / resume |

## Code structure

`game.js` is a single classic (non-module) script, matching the rest of the
repo, so the tests can reach state and helpers as plain globals.

- **Layout** — `buildLevel(n)` picks one of the three layout builders and
  paints orange pegs onto it with a seeded RNG (`srand`/`rand`), so a given
  level number always produces exactly the same board.
- **Simulation** — `step(dt)` advances the bucket, the held-key aiming and,
  while a shot is live, the ball in fixed sub-steps. It is the only place
  time passes; the animation loop simply calls it.
- **Shot lifecycle** — `fire()` starts a shot, `endShot(caught)` removes the
  lit pegs and decides whether the level is cleared, the game is over, or the
  player simply aims again.
- **Rendering** — `draw()` paints the board, pegs, ball, aim guide and bucket
  from state; it never mutates state.

## Assumptions

These were resolved without asking, per the task brief; the simpler reading
was taken each time.

1. **Branch name.** The task asks for a branch named after the game
   (`peg-blast`), but this session's standing instructions pin all work to the
   assigned branch `claude/loving-euler-gdtch7`. The assigned branch wins;
   the game name lives in the folder and commit message instead.
2. **One ball at a time.** No multiball, no bumpers, no power-ups — a single
   ball per shot keeps the physics and the scoring readable.
3. **The bucket catches, it does not bounce.** A ball reaching the bucket's
   mouth is caught outright rather than rebounding off its rim; the rim is
   drawn but is not a collision surface.
4. **Pegs are static circles.** No moving pegs and no peg-to-peg interaction.
5. **Balls do not carry over between levels.** Each level starts with a fresh
   10; leftovers are converted into bonus points instead, which keeps the
   difficulty flat and the maths obvious.
6. **Layouts cycle rather than grow.** Level 4 reuses the grid layout with a
   different orange selection. Difficulty comes from the shuffle, not from an
   ever-denser board.
7. **Aim is clamped to ±75°.** Firing sideways or upward is disallowed, so
   every shot is a drop.
8. **`autoAdvance` is a documented testing hook.** The animation loop checks
   this global before stepping; tests set it to `false` so they can advance
   the simulation themselves without `requestAnimationFrame` racing them.
   Gameplay never changes it.
