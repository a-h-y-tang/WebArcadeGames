# Burger Time

A girder-maze arcade game, built with plain HTML5 canvas and JavaScript — no
build step, no dependencies. You are the chef in a kitchen made of girders and
ladders. Four burgers hang in pieces above four plates; walk the full width of a
layer to knock it down a girder, and keep marching layers downward until every
burger is stacked on its plate.

A hot dog, an egg and a pickle chase you through the same lattice. Touch one and
you lose a life — unless you get a shake of pepper in first, or drop a bun on its
head.

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
| Space | Throw pepper (also starts / restarts the game) |
| P | Pause / resume |

- Each burger layer is four segments wide. Walk over **all four** segments and
  the layer drops one girder — worth **50 points**.
- A dropped layer lands on top of whatever is on the girder below, so keep
  walking it down until it reaches the plate (**100 points**). A finished burger
  pays **500**, and serving all four clears the level for **1000** more.
- Ladders sit at the same five columns between every pair of girders, so you can
  always reach every layer. You climb faster than the enemies, but you cannot
  outlast them.
- **Pepper** freezes every enemy in the cloud for a few seconds — you can walk
  straight past a frozen enemy. You get 5 shakes per level.
- A falling layer **squashes** anything under it for **500 points**. Squashed
  enemies return a few seconds later.
- You start with 3 lives; when the last one is gone the game ends. Your best
  score is saved in the browser's `localStorage`.

## Development

Burger Time follows the repo-wide test setup. From the repository root:

```powershell
npm install
npx playwright install chromium
npx playwright test BurgerTime/tests/
```

See [DESIGN.md](DESIGN.md) for how the code is structured, which simplifications
were made against the arcade original, and how the simulation is made
deterministic for testing.
