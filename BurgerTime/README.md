# BurgerTime

Build four burgers by stomping their layers down onto the plates — while hot
dogs, fried eggs and pickles chase you around the kitchen.

![BurgerTime](screenshot.png)

## Playing

Open `index.html` in any browser. No build step or server required.

## How to play

* Walk the **full width** of an ingredient to tip it off its girder. Every one
  of its four segments has to be trodden on.
* A falling ingredient knocks loose anything resting on the girder below it, so
  tipping a top bun can cascade a whole burger onto the plate at once.
* Land every layer of all four burgers on the plates to clear the level.
* Enemies kill you on contact. Throw pepper to freeze them for a few seconds,
  or drop an ingredient on their heads to flatten them.
* Three lives, five pepper shakers, and one extra shaker per level cleared.

## Controls

| Key | Action |
|---|---|
| `←` `→` / `A` `D` | Walk |
| `↑` `↓` / `W` `S` | Climb ladders |
| `Space` | Throw pepper (also starts the game) |
| `P` | Pause |

## Scoring

| Event | Points |
|---|---|
| Tipping an ingredient | 50 |
| Ingredient reaching a plate | 100 |
| Squashing an enemy | 100, doubling per extra enemy in the same fall |
| Clearing a level | 500 |

Your best score is stored in the browser.

## Development

Design notes are in [DESIGN.md](DESIGN.md). Tests:

```powershell
npx playwright test BurgerTime/tests/
```
