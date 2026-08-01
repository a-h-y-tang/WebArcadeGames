# Burger Time

A platform-and-ladder arcade game, built with plain HTML5 canvas and JavaScript
— no build step, no dependencies. You're a chef loose in a kitchen made of
girders and ladders. Walk the full length of an ingredient to knock it down onto
the one below; knock the whole burger onto the plate, three burgers to a level,
while hot dogs, eggs and pickles chase you around the kitchen.

Inspired by the 1982 Data East classic.

![Burger Time screenshot](screenshot.png)

## How to play

Open `index.html` in any modern browser. Press **Space** (or click **Start
Game**) to begin.

| Key | Action |
|---|---|
| ← / → (or A / D) | Walk along a girder |
| ↑ / ↓ (or W / S) | Climb a ladder |
| Space | Throw pepper (also starts / restarts the game) |
| P | Pause / resume |

- Each ingredient is four paces wide. You have to walk across **all four** to
  knock it loose — half a pass just leaves a dent.
- A falling ingredient sweeps along everything it lands on, so treading on an
  untouched **top bun** sends the entire burger down to the plate in one run.
  Ingredients that come to rest part-way down have to be trodden on again.
- **Serve all three burgers** to clear the level. Every level after that has
  faster and more numerous enemies.
- **Pepper** (Space) freezes anything in front of you for a few seconds — long
  enough to slip past. You get five shakes per level, so save them.
- **Dropping an ingredient on an enemy squashes it**, and each extra enemy the
  same ingredient catches on its way down is worth more than the last. Luring
  two hot dogs under one patty is the best money in the game.
- You start with 3 lives. Your best score is saved in the browser's
  `localStorage`.

## Scoring

| Event | Points |
|---|---|
| Knocking an ingredient loose | 50 |
| Each ingredient served on a plate | 100 |
| Squashing an enemy | 500 × how many that ingredient has squashed |
| Completing a level | 1000 |

## Development

Burger Time follows the repo-wide test setup. From the repository root:

```powershell
npm install
npx playwright install chromium
npx playwright test BurgerTime/tests/
```

See [DESIGN.md](DESIGN.md) for how the code is structured and how the simulation
is made deterministic for testing.
