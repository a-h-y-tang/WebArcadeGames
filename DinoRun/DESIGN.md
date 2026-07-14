# Dino Run — Design

## Game concept

Dino Run is an endless side-scrolling runner inspired by the classic Chrome
offline dinosaur game. A little dinosaur runs automatically across a desert
floor while obstacles (cacti on the ground and birds in the air) scroll
towards it from the right. The player jumps or ducks to avoid them. The world
speeds up the longer you survive, and the score is the distance travelled.
Hitting an obstacle ends the run.

## Mechanics

- **Automatic running.** The dino never moves horizontally; instead the world
  scrolls left at the current game speed. Score increments with distance.
- **Gravity & jumping.** The dino has a vertical velocity. Pressing jump while
  grounded applies an upward impulse; constant gravity pulls it back down. The
  dino cannot double-jump — a new jump is only allowed once it is back on the
  ground.
- **Ducking.** Holding the duck key shrinks the dino's hitbox to half height so
  it can slip under flying birds. Releasing restores full height. Ducking while
  airborne pulls the dino down faster (fast-fall).
- **Obstacles.** Two kinds:
  - *Cacti* sit on the ground in small clusters and must be jumped.
  - *Birds* fly at one of a few heights; low birds are jumped, high/mid birds
    are ducked under.
  Obstacles spawn on a distance-based timer with a randomised gap so the run is
  never identical, but a minimum gap guarantees the run is always survivable.
- **Speed ramp.** The scroll speed increases slowly with distance, making later
  obstacles arrive faster.
- **Collision.** Axis-aligned bounding-box (AABB) overlap between the dino's
  current hitbox and any obstacle ends the game.
- **Scoring.** Score is `floor(distance / 10)`. The best score is persisted to
  `localStorage` under the key `dino-best` and shown in the HUD.
- **States.** `idle` (start overlay) → `running` → `over` (game-over overlay).
  A jump/duck/Space press or the on-screen button starts or restarts the game.

## Controls

| Key | Action |
|---|---|
| Space / ↑ / W | Jump (and start / restart) |
| ↓ / S | Duck (hold) |
| P | Pause / resume |

An on-screen **Start / Play Again** button mirrors the keyboard start.

## Rendering

A single 600×200 canvas. Everything is drawn with canvas primitives (rectangles
for the dino, cacti, birds, ground and a scrolling dotted floor line) — no image
assets, so the game runs from `index.html` with no build step or network access.

## Testing approach (TDD)

The game logic is written as plain globals on a classic (non-module) script so
the Playwright tests can read and drive state directly (mirroring Snake and
Tetris in this repo). Tests were written first and cover:

- initial/idle state, canvas size, HUD zeros, best-score load
- starting via key and button
- jump physics (leaves ground, returns, no double-jump)
- ducking shrinks/restores the hitbox and fast-falls
- deterministic obstacle spawning via an injectable spawn helper
- AABB collision ending the game
- scoring from distance and best-score persistence to localStorage
- pause/resume freezing the world
- restart resetting score and obstacles

Physics is advanced through an exposed `step(dt)` function so tests can simulate
frames deterministically without relying on wall-clock `requestAnimationFrame`
timing.

## Assumptions

- **Folder name.** Uses `DinoRun/` (PascalCase) to match the existing
  `Snake/`, `Tetris/`, `Breakout/` folders; the git branch is the kebab-case
  `dino-run` as requested.
- **Simplicity over fidelity.** No sprite art, sound, or day/night cycle — the
  simpler interpretation was chosen. Shapes are solid rectangles/triangles.
- **Deterministic testing.** Where randomness would make tests flaky (obstacle
  gaps), a `spawnObstacle(type, opts)` helper lets tests place obstacles
  explicitly, and `step(dt)` advances physics by an explicit delta.
- **Fixed timestep.** The render loop advances physics with the real frame
  delta clamped to a maximum, but all game logic is expressed per-second so it
  is resolution-independent.
- **Best-score key.** `localStorage['dino-best']`, consistent with the
  `tetris-best` / `snake` style keys used elsewhere.
