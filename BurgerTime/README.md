# BurgerTime

A single-screen arcade platform game built with plain HTML5 canvas and
JavaScript — no build step, no dependencies. You are **the chef**, running along
a lattice of floors and ladders, stomping burger ingredients down onto the
plates below while hot dogs, eggs and pickles chase you around the kitchen.

Inspired by the 1982 Data East classic.

![BurgerTime screenshot](screenshot.png)

## How to play

Open `index.html` in any modern browser. Press **Space** (or click **Start
Game**) to begin.

| Key | Action |
|---|---|
| ← / → or A / D | Walk along a floor |
| ↑ / ↓ or W / S | Climb a ladder |
| Space | Throw pepper (also starts / restarts the game) |
| P | Pause / resume |

- Each of the four burgers is stacked across the top four floors: top bun,
  lettuce, patty, bottom bun. Walk over **all four segments** of an ingredient
  to knock it down to the next floor.
- An ingredient that lands on another one knocks that one loose too, so a whole
  stack can cascade down at once — the fastest way to build a burger.
- An ingredient that reaches the bottom settles on the **plate**. Plate every
  ingredient of every burger to clear the stage.
- **Enemies** climb the lattice hunting you. One touch costs a chef. You start
  with 3.
- **Pepper** (Space) freezes every enemy in the cloud for five seconds. You get
  five shakes, plus one more for each stage you clear — spend them wisely.
- A **falling ingredient squashes** any enemy underneath it for 500 points, which
  is worth setting up deliberately.
- Clearing a stage speeds the enemies up and lets more of them onto the lattice
  at once.

### Scoring

| Event | Points |
|---|---|
| Ingredient drops one floor | 50 |
| Ingredient lands on a plate | 100 |
| Enemy squashed by an ingredient | 500 |
| Stage cleared | 1000 |

Your best score is saved in the browser's `localStorage`.

## How it works

`game.js` is a single classic script. The world is a lattice of five floor lines
and four full-height ladders; the chef and the enemies share one movement
routine that only allows horizontal travel on a floor and vertical travel on a
ladder. All motion is per-second and applied through `step(dt)`, which makes the
simulation frame-rate independent and lets the tests drive it deterministically.
See [DESIGN.md](DESIGN.md) for the full model, the enemy AI and the assumptions
behind this version.

## Development

BurgerTime follows the repo-wide test setup. From the repository root:

```powershell
npm install
npx playwright install chromium
npx playwright test BurgerTime/tests/
```

The suite covers the lattice movement rules, ingredient pressing and chain
drops, plating and stage completion, enemy chasing, pepper stuns, squashes,
lives, pausing, score persistence and the game-browser catalogue entry.
