# Burger Time

A single-screen platform arcade game, built with plain HTML5 canvas and
JavaScript — no build step, no dependencies. **Chef Pepper** runs along a lattice
of girders and ladders holding three unfinished burgers. Walk the full width of an
ingredient and it drops to the girder below; keep knocking pieces down until every
burger lands on the plates at the bottom.

Three food enemies chase you the whole time. Freeze one with the pepper pot, or
drop an ingredient on its head and squash it flat.

Inspired by the 1982 Data East arcade classic.

![Burger Time screenshot](screenshot.png)

## How to play

Open `index.html` in any modern browser. Press **Space** (or click **Start
Game**) to begin.

| Key | Action |
|---|---|
| ← / A | Walk left |
| → / D | Walk right |
| ↑ / W | Climb up a ladder |
| ↓ / S | Climb down a ladder |
| Space | Shake the pepper pot — also starts the game and continues to the next level |
| P | Pause / resume |

- **Walk across all four segments** of an ingredient to knock it down one girder.
  Stop halfway and the pressed segments stay down, waiting for you to finish.
- **Chain reactions pay.** A falling piece knocks loose whatever it lands on, and
  the growing stack keeps going. Every ingredient scores for every girder it
  travels, so a well-set-up cascade is worth far more than walking pieces down one
  by one.
- **Serve all three burgers** — four ingredients each, all the way to the plates —
  to clear the level.
- **Pepper** stuns an enemy for a few seconds and makes it safe to walk through.
  You get five shakes per level; the pot refills when you clear a level.
- **Squash an enemy** by dropping an ingredient on it for 500 points.
- You start with 3 lives. Later levels bring faster and, eventually, more enemies.
- Your best score is saved in the browser's `localStorage`.

### Scoring

| Event | Points |
|---|---|
| Each ingredient that falls one girder | 50 |
| Enemy peppered | 100 |
| Enemy squashed by a falling ingredient | 500 |
| Level cleared | 1000 × level |

## Development

Burger Time follows the repo-wide test setup. From the repository root:

```powershell
npm install
npx playwright install chromium
npx playwright test BurgerTime/tests/
```

See [DESIGN.md](DESIGN.md) for how the code is structured, how the level map is
generated, and how the simulation is made deterministic for testing.
