# Cloud Jumper

An endless vertical platformer built with HTML5 Canvas. Bounce ever higher up a
ladder of floating platforms — steer, don't fall.

## How to Play

Open `index.html` in any modern browser — no build step, no dependencies.

| Input | Action |
|---|---|
| ← / → or A / D | Steer left or right |
| Space or ← / → | Start / restart |
| P | Pause / resume |

**Objective:** Your character bounces automatically each time it lands on a
platform. Steer left and right to keep catching the next platform above. The
higher you climb, the higher your score. Fall off the bottom of the screen and
the run is over.

**Tip:** The screen wraps horizontally — glide off one edge to reappear on the
other and reach an awkwardly-placed platform.

Your best score is saved in `localStorage` and persists between sessions.

## Design

See [design.md](design.md) for how the code works — the fixed-timestep loop,
the bounce and scroll physics, endless platform recycling, and rendering.

## Tests

Playwright specs live in [tests/](tests/):

```powershell
npx playwright test CloudJumper/tests/
```
