# BurgerTime

A platform-and-ladder arcade game, built with plain HTML5 canvas and JavaScript
— no build step, no dependencies. You are **Chef Pepper**, running around a
scaffold of floors and ladders draped with the parts of four giant hamburgers.
Walk the full length of an ingredient and it drops a floor. Knock every piece
down onto the plates at the bottom to serve the burgers and clear the level.

You are not alone up there: hot dogs, fried eggs and pickles patrol the
scaffold and home in on you. One touch costs a life. Your only weapon is a
finite supply of pepper.

Inspired by the 1982 Data East arcade classic.

![BurgerTime screenshot](screenshot.png)

## How to play

Open `index.html` in any modern browser. Press **Space** (or click **Start
Game**) to begin.

| Key | Action |
|---|---|
| ← / → / A / D | Walk — only works while standing on a floor |
| ↑ / ↓ / W / S | Climb — only works while on a ladder |
| Space | Throw pepper (or start the game from the title / game-over screen) |
| P | Pause / resume |

## Rules

- Each of the four burger lanes holds a **top bun, lettuce, patty and bottom
  bun**, spread down the upper four floors.
- An ingredient is divided into **three segments**. Tread on all three and the
  piece falls to the floor below — so you have to walk its whole length, not
  just step on the end.
- If a falling piece lands on another ingredient, that one is knocked down too
  and the pair keeps going. **Chaining a cascade is the fastest way to plate a
  lane.**
- Land every one of the 16 pieces on the plates to clear the level. That is
  worth **1000 points**, plus an extra pepper, and the next level's enemies are
  faster and more numerous.
- Enemies chase you relentlessly. Touching one costs a life; you keep whatever
  ingredient progress you had, but everybody resets to their starting spot.

## Scoring

| Event | Points |
|---|---|
| Knocking an ingredient down one floor | 50 |
| Squashing an enemy with a falling ingredient | 100 for the first, 200 for the second in the same drop, 300 for the third… |
| Clearing a level | 1000 |

Squashed enemies also push the ingredient **an extra floor down**, so timing a
drop onto a crowd is worth far more than the points alone.

## Pepper

You start with five shots and earn one per level. A shot throws a cloud one tile
ahead of you and freezes anything caught in it for three seconds — frozen
enemies cannot move and cannot hurt you. Use it to escape a pincer, or to hold
an enemy in place under an ingredient you are about to drop.

Your best score is saved in the browser's `localStorage`.

## Development

Tests live in `tests/` and run with the repo's Playwright setup:

```powershell
npx playwright test BurgerTime/tests/
```

See [DESIGN.md](DESIGN.md) for how the code is put together and which
assumptions were made.
