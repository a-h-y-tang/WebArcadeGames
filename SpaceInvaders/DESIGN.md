# Space Invaders — Design

## Concept

A faithful take on the 1978 arcade landmark. A grid of alien invaders marches
side to side and creeps downward one step each time it reaches an edge. You
command a laser cannon that slides along the bottom of the screen, firing
upward. Clear the whole formation before it reaches you. The aliens shoot back —
take too many hits, or let the swarm land, and it's game over.

The game reuses the shared arcade shell used by the other games in this repo: an
`idle → running → paused → over` state machine, a canvas with a HUD above it, an
overlay for start / pause / game-over, and a best score persisted to
`localStorage`.

## Mechanics

- **Marching swarm.** All living invaders move as one block at a shared
  horizontal speed. When the block's leading edge touches a wall it reverses
  direction and every invader drops down one row. The swarm speeds up as its
  numbers thin — the classic "they get faster as you kill them" tension — and
  starts faster on each later wave.
- **The cannon.** Moves left/right and is clamped to the screen. It fires bullets
  straight up; at most `MAX_PLAYER_BULLETS` (3) of your shots exist at once, so
  you cannot simply hold fire and blanket the screen.
- **Alien fire.** On a recurring timer the swarm drops a bomb from the
  bottom-most invader of a column, chosen by a rotating index (deterministic, no
  `Math.random`, so tests are reproducible). Bombs fall straight down.
- **Scoring.** Invaders are worth more the higher up they sit — top row = 30,
  middle rows = 20, bottom rows = 10 (the classic arcade weighting).
- **Lives & loss.** A bomb that hits the cannon costs one of three lives; losing
  the last ends the game. If any invader reaches the cannon's row, the swarm has
  landed and the game ends immediately regardless of lives.
- **Waves.** Clearing every invader advances the level and spawns a fresh, faster
  formation.
- **Pause.** `P` toggles pause; the loop halts and an overlay is shown.

## Controls

| Action           | Keys                        |
|------------------|-----------------------------|
| Move left        | `←` / `A`                   |
| Move right       | `→` / `D`                   |
| Fire             | `Space`                     |
| Start / Restart  | `Space` / an arrow key      |
| Pause / Resume   | `P`                         |

## Implementation notes

`game.js` keeps all mutable state in module-level variables (`player`,
`invaders`, `playerBullets`, `bombs`, `score`, `lives`, `level`, `state`,
`invaderDir`) and drives simulation through a single `step(dt)` function that
advances the world by `dt` milliseconds. Motion is expressed in **pixels per
millisecond**, so the simulation is frame-rate independent and the
`requestAnimationFrame` loop simply feeds it the real elapsed time (clamped to
avoid large jumps).

The swarm is a flat array of `{row, col, x, y, w, h, alive}` cells. Marching
computes the living block's left/right extent, and reverses + drops when a step
would push it past a wall. Collisions are axis-aligned box overlaps: player
bullets against invaders, bombs against the cannon.

Because the same globals and `step(dt)` are exposed on `window`, the Playwright
suite can position the cannon, bullets, bombs, and invaders deterministically and
assert on the outcome of a single simulation step — exactly how the Breakout /
Snake tests in this repo drive their logic.

## Assumptions

Per the task's guidance to prefer the simpler reading and document it:

- **No destructible bunkers.** The original has four shields the player hides
  behind. They are omitted to keep the scope focused on the march-and-shoot core;
  the trade-off is a slightly more exposed cannon, which the three lives offset.
- **No bonus UFO.** The occasional flying-saucer bonus target is left out.
- **Deterministic alien fire.** The firing column rotates through an index rather
  than being random, so a bomb's origin is reproducible for tests. Timing is a
  fixed cooldown.
- **Circular / box collisions** use simple bounding boxes rather than
  pixel-perfect sprite masks — invisible to the player and far simpler to test.
- The canvas is a fixed **500×500** to match the other games in the repo.
- Best score is stored under the `localStorage` key **`space-invaders-best`**.
