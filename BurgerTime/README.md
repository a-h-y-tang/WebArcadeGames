# Burger Time

Build three hamburgers by walking their ingredients down a lattice of floors and
ladders — while hot dogs, fried eggs and pickles try to walk into you.

![Burger Time](screenshot.png)

## Playing

Open `index.html` in any browser. No build step, no server.

## How to play

- Walk the **whole length** of an ingredient to make it collapse to the floor
  below. Each ingredient is four segments wide, and every segment has to be
  trodden on.
- A falling ingredient shoves whatever it lands on one floor further down, so a
  single drop ripples through the column. Four passes serve one burger.
- Push all four parts of all three burgers onto the plates at the bottom to
  clear the level.
- Enemies patrol the same floors and ladders. One touch costs a life.
- **Space** throws pepper: a cloud in front of you freezes anything caught in it
  for four seconds. You get five shakers per level.
- Drop an ingredient on an enemy's head to flatten it — 500 points, far more than
  any ingredient is worth.

## Controls

| Input | Action |
|---|---|
| ← → / A D | walk (only while standing on a floor) |
| ↑ ↓ / W S | climb (only while lined up with a ladder) |
| Space | throw pepper — also starts and restarts the game |
| P | pause / resume |

## Scoring

| Event | Points |
|---|---|
| Ingredient dropped by stepping it | 50 |
| Ingredient landing on a plate | 100 |
| Enemy squashed by a falling ingredient | 500 |
| Level cleared | 1000 |

Each level adds another enemy (up to five) and makes them faster. Your best
score is kept in the browser's local storage.

## Under the hood

See [DESIGN.md](DESIGN.md) for the pile model, the push-down rule, the enemy AI
and the full list of simplifications made against the 1982 arcade original.

## Tests

```powershell
npx playwright test BurgerTime/tests/
```
