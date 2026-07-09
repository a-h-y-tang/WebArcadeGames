# Flappy Bird

A one-button HTML5 Canvas take on the classic. Keep the bird in the air and
thread it through the scrolling pipes.

## How to Play

Open `index.html` in any modern browser — no build step, no dependencies.

| Input | Action |
|---|---|
| Space / ↑ / W / click | Flap (also starts / restarts) |
| Start button | Start / restart |
| P | Pause / resume |

**Objective:** Gravity is always pulling the bird down. Flap to climb, then let
it fall — steer through the gap in each pipe. Every pipe you clear scores a
point. Touching a pipe or the ground ends the run.

Your best score is saved in `localStorage` and persists between sessions.

## Under the hood

See [DESIGN.md](DESIGN.md) for the physics model (fixed-timestep gravity),
pipe spawning/scoring, collision handling, and the assumptions made.

Tests live in [`tests/flappy.spec.js`](tests/flappy.spec.js) and run with
Playwright (`npx playwright test FlappyBird/tests/`).
