# Kaboom! — Design

## Concept

Kaboom! is a reflex arcade game inspired by the 1981 Activision classic. A **Mad
Bomber** paces back and forth across the top of the screen, dropping bombs. The
player controls a horizontally-moving **stack of buckets** at the bottom and must
catch every bomb before it hits the ground. A caught bomb scores points; a bomb
that reaches the floor explodes, destroying one bucket and detonating every other
bomb currently in the air. Lose all your buckets and the game is over.

The bomber gets faster and drops bombs more often with every wave you clear, so
the game ramps from leisurely to frantic.

## Mechanics

- **The board** is a 600×400 canvas. The bomber lives near the top; the buckets
  slide along a catch line near the bottom.
- **Dropping bombs.** The bomber moves left/right, bouncing off the walls, and
  releases a bomb from its current position on a repeating timer (`dropInterval`).
  Bombs fall straight down at a constant `bombSpeed`.
- **Catching.** A bomb is *caught* the moment it reaches the catch line while its
  x-position is within half a paddle-width of the bucket stack's centre. A caught
  bomb is removed and awards `wave` points (bombs are worth more in later waves).
- **Missing.** A bomb that crosses the catch line *outside* the paddle keeps
  falling; when it drops below the floor it is *missed*. A miss destroys one
  bucket, clears every bomb currently on screen (a chain explosion), and resets
  progress toward the current wave (you must re-catch the group).
- **Waves.** Catch `BOMBS_PER_WAVE` (10) bombs to clear a wave. Clearing a wave
  increments `wave`, awards a bonus bucket (capped at `MAX_BUCKETS`), and speeds
  up both the bomber and the bombs while shortening the drop interval.
- **Lives.** You start with 3 buckets and can hold up to 5. When the last bucket
  is destroyed the game ends.
- **Scoring.** Score accumulates from caught bombs. The best score is persisted
  in the browser's `localStorage` under `kaboom-best`.

### Difficulty scaling (all derived purely from `wave`)

| Quantity      | Formula                                    |
|---------------|--------------------------------------------|
| `bombSpeed`   | `BOMB_BASE + (wave-1) * BOMB_STEP`         |
| `bomberSpeed` | `BOMBER_BASE + (wave-1) * BOMBER_STEP`     |
| `dropInterval`| `max(DROP_MIN, DROP_BASE - (wave-1)*DROP_STEP)` |
| points/bomb   | `wave`                                     |

Because these are pure functions of `wave`, the simulation is fully
deterministic given the wave number and player input — which is what makes the
Playwright tests reliable.

## Controls

| Input                 | Action                                    |
|-----------------------|-------------------------------------------|
| ← / A                 | Move the bucket stack left                |
| → / D                 | Move the bucket stack right               |
| Mouse move            | Slide the bucket stack to the pointer     |
| Space                 | Start / restart the game                  |
| P                     | Pause / resume                            |

## Determinism & testing

Following the pattern used by the other games in this repo (Dino Run, Tetris,
Snake), the game is written as a single classic (non-module) script so its state
and functions are reachable from Playwright as plain globals. All motion is
expressed per-second and advanced through `step(dt)`, which runs fixed
sub-steps internally. Tests drive the game by calling `startGame()`, positioning
the player and bombs directly, and calling `step(dt)` — no dependence on
`requestAnimationFrame` wall-clock timing.

Bomb spawning during automated play uses the drop timer, but tests that need a
bomb at a precise position call `spawnBomb({ x, y })` directly, so no test relies
on randomness. The bomber moves by deterministic wall-bouncing (no random
direction changes), keeping every tested code path reproducible.

## Assumptions

These choices were made where the brief was open-ended; the simpler option was
taken each time and recorded here:

- **Fixed catch line.** In the original arcade game the bucket stack's height
  (and therefore the catch position) shrinks as buckets are lost. Here the catch
  line is fixed regardless of how many buckets remain — simpler and it keeps the
  catch geometry constant for testing. Remaining buckets are purely a life count.
- **Miss resets the wave group.** Missing a bomb resets `caughtThisWave` to 0, so
  a miss costs both a bucket and your progress toward the next wave. This mirrors
  the original's "restart the group" feel without extra state.
- **Deterministic bomber.** The bomber only reverses at the walls; it never
  changes direction randomly. This trades a little unpredictability for fully
  reproducible tests.
- **Bonus bucket per wave.** Clearing a wave grants one bucket (capped at 5). The
  original's bonus schedule is more elaborate; one-per-wave is the simple version.
- **Both keyboard and mouse control** the paddle, so the game is playable on a
  trackpad as well as a keyboard.
