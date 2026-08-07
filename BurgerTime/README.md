# Burger Time

Run the floors, climb the ladders, and stomp four burgers into shape before the
food catches you.

![Burger Time](screenshot.png)

## How to play

Open `index.html` in a browser — no build step or server required.

Each burger hangs in pieces across five floors of the kitchen. **Walk across
every slice of an ingredient** and it drops to the floor below. Keep walking it
down until it lands on the plate, and do that for all sixteen ingredients to
clear the level.

You are not alone up there. Enemies hunt you down every floor and ladder. Touch
one and you lose a chef.

Two ways to fight back:

- **Drop an ingredient on them.** A falling slab flattens anything underneath,
  and each extra enemy caught in the same fall is worth double.
- **Shake the pepper.** It freezes everything in front of you for a few
  seconds. Frozen enemies are harmless to walk through — but you only get five
  shakes, plus one more for every level you clear.

An ingredient that lands on one already resting below knocks *that* one loose
too, chaining down the lane. Setting up a cascade with enemies underneath is
where the big scores are.

## Controls

| Input | Action |
|---|---|
| ← → / A D | Walk along a floor |
| ↑ ↓ / W S | Climb a ladder |
| Space | Shake pepper (also starts / restarts) |
| P | Pause |

## Scoring

| Event | Points |
|---|---|
| Dropping an ingredient one floor | 50 |
| An ingredient reaching the plate | 100 |
| Squashing enemies in one fall | 100, 200, 400, … |
| Clearing a level | 1000 |

Your best score is kept in the browser between sessions.

Later levels send more enemies and move them faster.

## Development

See [DESIGN.md](DESIGN.md) for how the code works.

```powershell
npx playwright test BurgerTime/tests/
```
