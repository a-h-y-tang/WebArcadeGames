# Pac-Man

A compact Pac-Man on an HTML5 canvas. Eat every pellet, dodge the ghosts, and
grab a power pellet to turn the hunt around.

## How to play

Open `index.html` in any modern browser — no build step or server required.

### Controls

| Action          | Keys                        |
|-----------------|-----------------------------|
| Move            | `←` `↑` `→` `↓` or `W A S D` |
| Pause / resume  | `P`                         |
| Start / restart | `Space` or any arrow key    |

### Rules

- Eat all the pellets to clear the maze and advance to the next (faster) level.
- Pellets score 10 points; the four flashing **power pellets** score 50 and
  briefly turn the ghosts **frightened** — while frightened they flee and can be
  eaten for 200 points each. An eaten ghost becomes a pair of eyes that scurries
  home and revives.
- Touching a normal ghost costs a life. You start with 3; lose them all and it's
  game over.
- Your best score is saved in the browser via `localStorage`.

## Development

Tests are written with [Playwright](https://playwright.dev). From the repo root:

```powershell
npx playwright test PacMan/tests/
```

See [DESIGN.md](DESIGN.md) for how the code is structured.
