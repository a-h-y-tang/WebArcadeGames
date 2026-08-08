# BurgerTime

You are the chef. Four burgers hang unfinished across five floors of a kitchen
maze, and the only way to build them is to walk over every ingredient until it
falls onto the plate below. Hot dogs, eggs and pickles want to stop you.

Open `index.html` in a browser — no build step, no server.

## How to play

* Walk the full width of an ingredient to stomp it down one floor. Each
  ingredient is four quarters wide; the quarter under your feet sags as you
  press it, and the ingredient falls once all four are pressed.
* An ingredient that lands on another **shoves that one down a floor too**, so a
  well-timed stomp collapses a whole column.
* Drop an ingredient off the bottom floor and it lands on the plate. Plate all
  twelve ingredients to clear the level.
* Enemies chase you along the floors and up the ladders. One touch costs a life;
  you have three.
* Drop an ingredient on an enemy to squash it — 500 points, and the ingredient
  rides one extra floor down.
* Out of room? Throw pepper. It blinds anything it lands on for a few seconds.
  You get five shakes per level.

## Controls

| Input | Action |
|---|---|
| ← → (or A / D) | walk |
| ↑ ↓ (or W / S) | climb the ladder you are standing on |
| Space | throw pepper — also starts a game from the title screen |
| P | pause / resume |

## Scoring

| Event | Points |
|---|---|
| Ingredient drops a floor | 50 |
| Enemy squashed | 500 |
| Level cleared | 1000 |

Your best score is kept in the browser's local storage. Each new level adds a
faster enemy (up to five) and refills the pepper.

## Development

Playwright specs live in `tests/`. From the repository root:

```powershell
npx playwright test BurgerTime/tests/
```

`DESIGN.md` explains the geometry, the stepper, and the assumptions behind the
simplifications.
