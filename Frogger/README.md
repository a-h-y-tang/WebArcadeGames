# Frogger

A classic Frogger built with HTML5 Canvas — hop your frog across a busy road and
a log-strewn river to reach the home bays, without getting flattened or drowned.

## How to Play

Open `index.html` in any modern browser — no build step, no dependencies.

| Input | Action |
|---|---|
| Arrow keys or WASD | Hop one cell |
| P | Pause / resume |
| Any arrow / WASD | Start or restart |

**Objective:** Guide the frog from the bottom start row up to one of the five
empty **home bays** at the top.

- **Road (lower half):** dodge the cars — getting run over costs a life.
- **River (upper half):** the water is deadly, so ride the floating **logs**
  across. A log will carry your frog along; ride it off the screen edge and you
  drown.
- **Home:** land squarely in an empty bay to score. Miss the bays and it's
  fatal. Fill all five bays to clear the level — the bays reset and every lane
  gets faster.

**Scoring:** +10 for each new row you reach on a trip, +50 for landing in a bay,
and a +100 bonus for completing a full set of bays.

**Lives:** You start with 3. Your best score is saved in `localStorage` and
persists between sessions.

## Development

Tests live in `tests/frogger.spec.js` and run with the repo-wide Playwright
setup:

```powershell
npx playwright test Frogger/tests/
```

See [design.md](design.md) for how the code is structured.
