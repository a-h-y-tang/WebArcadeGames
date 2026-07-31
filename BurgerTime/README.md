# Burger Time

A ladders-and-platforms arcade game, built with plain HTML5 canvas and
JavaScript — no build step, no dependencies. Run your chef along five girders,
walk the burger ingredients down onto the plates below, and stay away from the
food that's chasing you.

Inspired by the 1982 Data East arcade classic.

![Burger Time screenshot](screenshot.png)

## How to play

Open `index.html` in any modern browser. Press **Space** (or click **Start
Game**) to begin.

| Key | Action |
|---|---|
| ← / → or A / D | Walk along a girder |
| ↑ / ↓ or W / S | Climb a ladder |
| Space | Throw pepper (starts the game when idle or after a game over) |
| P | Pause / resume |

- Each burger is four ingredients tall: top bun, lettuce, patty, bottom bun.
  Walk across **all four segments** of an ingredient to knock it down one level.
- An ingredient that lands on another knocks that one down too, so a well-timed
  drop can cascade a whole stack toward the plate.
- Land all 12 ingredients on the three plates to clear the level. Enemies get
  faster and spawn more often on every level after that.
- Enemies chase you along the girders and ladders. Touching one costs a chef;
  lose all three and the game is over.
- **Pepper** freezes everything directly in front of you for a couple of
  seconds. You start with 5 shakers and earn one back per level.
- An ingredient that falls on an enemy squashes it for **500** points.
- Your best score is saved in the browser's `localStorage`.

### Scoring

| Event | Points |
|---|---|
| Knock an ingredient down a level | 50 |
| Land an ingredient on a plate | 100 |
| Squash an enemy | 500 |
| Clear a level | 1000 |

## Development

Burger Time follows the repo-wide test setup. From the repository root:

```powershell
npm install
npx playwright install chromium
npx playwright test BurgerTime/tests/
```

See [DESIGN.md](DESIGN.md) for how the board, physics and enemy AI work.
