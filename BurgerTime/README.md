# BurgerTime

A single-screen platform-and-ladder arcade game. You are a chef on a lattice of
girders. Walk the full length of a burger ingredient and it drops to the girder
below — drop every ingredient onto the plates at the bottom of the screen to
build the burgers and clear the level, while hot dogs, fried eggs and pickles
chase you around the kitchen.

Open `index.html` in a browser. No build step, no server.

## How to play

| Input | Action |
|---|---|
| `←` `→` (or `A` `D`) | walk along a girder |
| `↑` `↓` (or `W` `S`) | climb a ladder |
| `Space` | throw pepper (also starts and restarts the game) |
| `P` | pause / resume |

* Each ingredient is split into four sections. Walking over a section presses
  it down; press all four and the ingredient falls.
* A falling ingredient knocks loose any ingredient it lands on, so one drop can
  cascade a whole lane onto the plate.
* Enemies caught underneath a falling ingredient are squashed for 500 points and
  come back a few seconds later.
* Touching an enemy costs a chef. Pepper freezes any enemy in the cloud for a
  few seconds — frozen enemies are harmless, so you can walk straight past them.
* Two of the four ladders are partial: the one on the left runs the full height,
  so it is always your escape route.

## Scoring

| Event | Points |
|---|---|
| Ingredient lands on a girder or plate | 50 |
| Enemy squashed by a falling ingredient | 500 |
| Level cleared | 1000 × level |

Each new level is faster and adds another enemy (up to five), and refills your
shaker with one extra pepper. The best score is kept in `localStorage`.

## Files

| File | What it is |
|---|---|
| `index.html` | HUD, canvas and overlay |
| `style.css` | diner styling |
| `game.js` | all game logic and rendering |
| `DESIGN.md` | how the code works, and the assumptions behind it |
| `tests/burgertime.spec.js` | Playwright suite (59 tests) |

## Tests

From the repository root:

```powershell
npx playwright test BurgerTime/tests/
```
