# Missile Command

A browser remake of the 1980 arcade classic, rendered on an HTML5 `<canvas>`
with vanilla JavaScript. No build step, no server — just open `index.html`.

![status](https://img.shields.io/badge/status-complete-brightgreen)

## How to play

Waves of enemy missiles streak down toward your six cities. You defend them
from a central battery: **click anywhere on the field** to launch an
interceptor that flies to that point and detonates into an expanding blast. Any
enemy missile caught in the blast is destroyed. Let one through and it takes out
a city — lose all six and it's game over.

| Input | Action |
|---|---|
| Mouse click | Fire an interceptor at that point |
| `Space` | Start / restart |
| `P` | Pause / resume |

- **Chain your blasts** to catch clusters of missiles.
- **Watch your ammo** — it's limited per wave and refills when you clear one.
- **Survive the wave** to bank a bonus for every city still standing; the next
  wave arrives faster and heavier.
- Your best score is saved locally.

## Running the tests

From the repository root:

```powershell
npx playwright test MissileCommand/tests/
```

## Design

See [DESIGN.md](DESIGN.md) for the mechanics, architecture, and the assumptions
made while building the game.
