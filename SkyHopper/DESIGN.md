# Sky Hopper — Design

## Concept

Sky Hopper is a vertical, endless bouncing platformer. The hopper falls under
constant gravity and automatically springs back up every time its feet touch a
platform. The player only steers left and right; the bouncing is automatic. As
the hopper climbs, the camera follows it upward, fresh platforms are generated
above, and old platforms scroll off the bottom. The goal is to climb as high as
possible without missing a platform and falling off the bottom of the screen.

The design intentionally mirrors the other games in this repo (Snake, Asteroids,
Breakout): all mutable state and a deterministic `step(dtMs)` physics entry point
live at module top level so Playwright tests can reach them through
`page.evaluate()` and advance the simulation by an explicit number of
milliseconds — no reliance on `requestAnimationFrame` timing.

## Playfield

- Canvas is **400 × 600** pixels (portrait — natural for a vertical climber).
- World coordinates: **y increases downward**, same as canvas pixels. Climbing
  upward therefore means the hopper's world `y` *decreases* (goes negative).
- A **camera** (`cameraY`) holds the world-y that maps to screen row 0. Screen
  position of anything is `worldY - cameraY`. The camera only ever moves *up*
  (its value only decreases), so the score never goes backwards.

## Mechanics

- **Gravity** constantly accelerates the hopper downward (`vy` grows).
- **Auto-bounce**: when the hopper is moving downward and its feet cross the top
  edge of a platform while horizontally overlapping it, `vy` is reset to a fixed
  upward launch velocity. Bounces never happen while rising, so you pass up
  through platforms and only land on them coming down (classic doodle-jumper
  feel).
- **Horizontal wrap**: moving off the left edge re-enters from the right and
  vice-versa.
- **Camera follow**: whenever the hopper rises above 40 % of the screen height,
  the camera is pulled up so the hopper sits on that line. The distance the
  camera has travelled up from its start, divided by `SCORE_SCALE`, is the score.
- **Platform recycling**: platforms that scroll below the bottom of the view are
  removed; new platforms are generated above the current top-most platform so
  there is always something to land on ahead.
- **Platform types**:
  - `normal` — static.
  - `moving` — drifts horizontally and reverses at the screen edges. These start
    appearing once the score passes a threshold, ramping up difficulty.
- **Death**: if the hopper falls until its top edge is below the bottom of the
  screen, the game is over.

## Controls

| Input | Action |
|---|---|
| **← / A** | Steer left |
| **→ / D** | Steer right |
| **Space / Enter / click** | Start game (from the overlay) |
| **P** | Pause / resume |

## Scoring

- Score = `floor((startCameraY − cameraY) / SCORE_SCALE)` — how far the camera
  has climbed. It is monotonic (never decreases).
- The best score is persisted to `localStorage` under `skyhopper-best`.

## Determinism / testability

- Platform layout is produced by a small seedable PRNG (`mulberry32`). A normal
  start seeds it from the clock for variety; tests call `startGame(seed)` with a
  fixed seed so the layout is reproducible.
- `step(dtMs)` is pure with respect to time: calling it advances all physics by
  `dtMs` milliseconds. Tests drive the game by calling `step` directly rather
  than waiting on animation frames.
- The very first platform is always placed directly under the hopper so the
  first landing/bounce is deterministic regardless of seed.

## Assumptions

- "Novel game not yet in the repo": the repo already has Snake, Space Invaders,
  Flappy Bird, 2048, Tetris, Breakout, Lunar Lander, Missile Command, Pong,
  Minesweeper, Frogger and Asteroids. A vertical auto-bounce climber is distinct
  from all of these, so Sky Hopper was chosen. (A stray `GeoDash/` folder exists
  but is not listed in the README table nor marked *In Progress*, so it was left
  untouched.)
- The ambiguous "how high can platforms be spaced" question is resolved by
  keeping the maximum vertical gap comfortably below the maximum bounce height so
  every generated layout is always beatable.
- Simpler-interpretation choices: only two platform types (static + moving); no
  enemies, springs, or shooting — those would add scope without changing the core
  loop.
