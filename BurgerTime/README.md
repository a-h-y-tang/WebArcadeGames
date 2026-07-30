# BurgerTime

A ladders-and-girders arcade game, built with plain HTML5 canvas and JavaScript
— no build step, no dependencies. You are **Chef Peter Pepper**, and the burgers
are enormous. Walk the full length of an ingredient to knock it down a floor,
cascade the stacks onto the plates at the bottom, and assemble every burger
before Mr. Hot Dog, Mr. Egg and Mr. Pickle catch you.

Inspired by the 1982 Data East arcade classic.

![BurgerTime screenshot](screenshot.png)

## How to play

Open `index.html` in any modern browser. Press **Space** (or click **Start
Game**) to begin.

| Key | Action |
|---|---|
| ← / A | Walk left |
| → / D | Walk right |
| ↑ / W | Climb up (only when lined up with a ladder) |
| ↓ / S | Climb down |
| Space | Start the game / spray pepper |
| P | Pause / resume |

- Each ingredient is four segments wide. Step on **all four** and the whole
  stack under it drops one floor. Walk everything down to the plates to clear
  the level.
- An ingredient that lands on another one **pushes it a floor further**. Line a
  column up first and a single walk can carry three ingredients three floors —
  that cascade is where the big scores are.
- Touching an enemy costs a life and sends you back to the bottom girder; the
  burgers stay exactly where you left them.
- **Pepper** (Space) stuns anything in front of you for a couple of seconds. You
  only get five, topped up each level, so save it for a corner.
- Dropping an ingredient **on top of an enemy** flattens it for 300 points.
- Climbing past a girder is continuous — press left or right as you pass it to
  step off.
- Your best score is saved in the browser's `localStorage`.

## Scoring

| Event | Points |
|---|---|
| Ingredient lands a floor | 50 each |
| Ingredient reaches a plate | 100 each |
| Enemy squashed | 300 |
| Enemy peppered | 20 |
| Level complete | 1000 |

## Development

BurgerTime follows the repo-wide test setup. From the repository root:

```powershell
npm install
npx playwright install chromium
npx playwright test BurgerTime/tests/
```

The suite covers layout, chef movement and ladder rules, ingredient stepping and
the falling/pushing cascade, plating, enemy chase AI, pepper, level progression,
scoring and pause/restart.

See [DESIGN.md](DESIGN.md) for how the code is put together and which
simplifications were made against the arcade original.
