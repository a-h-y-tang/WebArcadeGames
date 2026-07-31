# BurgerTime

A platform/puzzle arcade game built with plain HTML5 canvas and JavaScript — no
build step, no dependencies. You are **Chef Pepper**, running around a lattice
of floors and ladders in a giant kitchen. Walk the full width of a burger
ingredient and it collapses to the floor below; keep knocking pieces down until
all three burgers are assembled on the plates at the bottom.

Meanwhile a hot dog, a pickle and a fried egg are chasing you. Squash them under
a falling ingredient, freeze them with a shake of pepper, or run.

Inspired by the 1982 Data East arcade classic.

![BurgerTime screenshot](screenshot.png)

## How to play

Open `index.html` in any modern browser. Press **Space** (or click **Start
Game**) to begin.

| Key | Action |
|---|---|
| ← / → / A / D | Walk along a floor |
| ↑ / ↓ / W / S | Climb a ladder |
| Space | Start the game — and shake pepper once you are playing |
| X | Shake pepper |
| P | Pause / resume |

- **Knock ingredients down.** Each ingredient is four segments wide. Walking
  over a segment makes it sag; once all four have been trodden on, the whole
  piece drops to the floor below. You can do it in one pass or in several.
- **Chain them.** An ingredient that lands on another knocks *that* one down a
  floor too, which can cascade all the way to the plate. Each landing is worth
  **50 points**.
- **Finish the burgers.** When all twelve pieces are on the plates the level is
  cleared: **1000 bonus points**, a pepper back, and a fresh kitchen with one
  more — and slightly faster — enemy.
- **Squash your pursuers.** Drop an ingredient while an enemy is standing on it
  and the enemy is flattened for **500 points**. It comes back after a few
  seconds.
- **Use the pepper.** A shake freezes anything in the cloud for three seconds.
  Frozen food cannot hurt you, so it is also a way past a blocked ladder. You
  start with five.
- **Lives.** Touching an unfrozen enemy costs a chef and sends everyone back to
  their starting spots — the ingredients you already dropped stay dropped. Lose
  all three chefs and the game ends.
- Your best score is saved in the browser's `localStorage`.

## Development

BurgerTime follows the repo-wide test setup. From the repository root:

```powershell
npm install
npx playwright install chromium
npx playwright test BurgerTime/tests/
```

See [DESIGN.md](DESIGN.md) for how the lattice, the falling rules and the enemy
chase are implemented, and how the simulation is kept deterministic for testing.
