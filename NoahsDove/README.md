# Noah's Dove

*"When the dove returned to him in the evening, there in its beak was a freshly
plucked olive leaf!"* — Genesis 8:11

A one-button HTML5 Canvas game. After the flood, Noah sends out a dove to find
dry land. Keep the dove in the air and thread it between the mountain peaks
rising out of the receding waters.

## How to Play

Open `index.html` in any modern browser — no build step, no dependencies.

| Input | Action |
|---|---|
| Space / ↑ / W / click | Flap (also starts / restarts) |
| Start button | Start / restart |
| P | Pause / resume |

**Objective:** Gravity is always pulling the dove down. Flap to climb, then let
it fall — steer through the gap between each pair of mountain peaks. Every gap
you clear scores a point. Touching the rock or the flood waters ends the run.

Your best score is saved in `localStorage` and persists between sessions.

## Under the hood

See [DESIGN.md](DESIGN.md) for the physics model (fixed-timestep gravity),
peak spawning/scoring, collision handling, and the assumptions made.

Tests live in [`tests/noahs-dove.spec.js`](tests/noahs-dove.spec.js) and run with
Playwright (`npx playwright test NoahsDove/tests/`).
