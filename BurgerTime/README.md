# Burger Time

Build four burgers by stomping their ingredients down through a kitchen of
girders and ladders — while a hot dog, an egg and a pickle try to catch you.

![Burger Time](screenshot.png)

## Play

Open `index.html` in any modern browser. No build step, no server.

## How to play

Walk the **entire length** of an ingredient and it drops one floor. Keep dropping
layers until all four land on the plate below. Finish all four burgers to clear
the level.

- An ingredient that lands on another knocks it loose as well, so a drop from the
  top can cascade a whole column onto its plate.
- An ingredient falling on an enemy squashes it flat — 100 points, and it's gone
  for a few seconds.
- Out of options? Throw pepper. It freezes anything in front of you for four
  seconds, but you only carry five shakers (you get one back per level).
- Touching an unfrozen enemy costs a life. You have three.

## Controls

| Input | Action |
|---|---|
| `←` `→` or `A` `D` | Walk |
| `↑` `↓` or `W` `S` | Climb a ladder |
| `Space` | Throw pepper · start / restart |
| `P` | Pause |
| `R` | Restart |

## Scoring

| Event | Points |
|---|---|
| Ingredient dropped | 50 |
| Enemy squashed | 100 |
| Burger completed | 250 |
| Level cleared | 1000 |

Your best score is kept in the browser's `localStorage`.

## Development

Tests live in `tests/` and run with the repo's Playwright setup:

```powershell
npx playwright test BurgerTime/tests/
```

See [DESIGN.md](DESIGN.md) for how the code is put together.
