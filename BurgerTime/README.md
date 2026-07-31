# BurgerTime

Build four burgers before the food catches you. Walk the full width of an
ingredient to drop it a floor, keep dropping until it lands on the plate, and
stay clear of the hot dogs, eggs and pickles patrolling the girders.

![BurgerTime](screenshot.png)

## Playing

Open `index.html` in any modern browser — no build step or server required.

## Controls

| Input | Action |
|---|---|
| `←` `→` or `A` `D` | Walk along a floor |
| `↑` `↓` or `W` `S` | Climb a ladder |
| `Space` | Throw pepper (also starts the game) |
| `P` | Pause / resume |

## How it works

- Every burger column has four ingredients — bun top, lettuce, patty, bun
  bottom — resting on the upper floors, with an empty plate at the bottom.
- Each ingredient is split into four segments. Walk over all four and the
  ingredient drops one floor.
- An ingredient that lands on another one shoves it down a floor too, so a
  well-timed drop moves a whole stack toward the plate.
- Ingredients that reach the plate are finished. Plate all sixteen and the level
  is cleared.
- Enemies stand still for a moment when they arrive, so you always get a beat to
  reposition after a level starts or a chef is lost.
- Touching an enemy costs a chef; you have three. Positions reset but the
  burgers you have already assembled stay put.
- Pepper freezes any enemy in the cloud for four seconds — you get five shakers
  per level, so save them for a corner.
- Drop an ingredient onto an enemy to squash it. It comes back after a few
  seconds, but the points are yours.

## Scoring

| Event | Points |
|---|---|
| Ingredient dropped | 50 |
| Enemy squashed | 100 |
| Level cleared | 1000 |

Your best score is stored in the browser under `burgertime-best`.

## Tests

```powershell
npx playwright test BurgerTime/tests/
```

See [DESIGN.md](DESIGN.md) for the level geometry, the falling/push rules and
the assumptions behind them.
