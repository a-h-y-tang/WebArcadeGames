# BurgerTime

Chef Pepper is trapped in a five-storey kitchen with four unfinished burgers and
a hungry pack of walking food. Stomp every ingredient down onto the plates before
Mr. Hot Dog, Mr. Egg or Mr. Pickle catches you.

![BurgerTime](screenshot.png)

## Playing

Open `index.html` in any browser — no build step or server required.

## Controls

| Input | Action |
|---|---|
| <kbd>←</kbd> <kbd>→</kbd> or <kbd>A</kbd> <kbd>D</kbd> | walk left / right |
| <kbd>↑</kbd> <kbd>↓</kbd> or <kbd>W</kbd> <kbd>S</kbd> | climb up / down a ladder |
| <kbd>Space</kbd> | throw pepper (also starts the game) |
| <kbd>P</kbd> | pause / resume |

## How to play

- **Flip ingredients.** Walk all the way across an ingredient to stomp it flat;
  it drops to the floor below. The dents along its underside show how much of it
  you have already trodden on.
- **Cascade.** An ingredient that lands on another knocks that one loose too, so
  a single stomp can shuffle a whole stack a floor lower. Ingredients that reach
  a plate stay put.
- **Finish the burgers.** Four ingredients on every plate clears the level. The
  next level restocks the kitchen with faster, more numerous enemies.
- **Pepper.** Five shots per level. A throw stuns everything in a short cone in
  front of you for a few seconds — long enough to slip past.
- **Squash them.** Far better than pepper: drop an ingredient onto an enemy and
  it rides down to a flat end. The first enemy squashed by an ingredient is worth
  500, and the bonus doubles for each extra one carried by the same drop.
- Touching a live enemy costs one of your three lives.

## Scoring

| Event | Points |
|---|---|
| Ingredient lands | 50 |
| Burger completed | 500 |
| Enemy squashed | 500, doubling per extra enemy on the same ingredient |
| Level cleared | 1000 × level |

The best score is kept in `localStorage`.

## Files

| File | Purpose |
|---|---|
| `index.html` | HUD, canvas and overlay markup |
| `style.css` | Diner-neon presentation |
| `game.js` | Game state, simulation and rendering |
| `DESIGN.md` | How the code works, plus the assumptions behind it |
| `tests/burgertime.spec.js` | Playwright suite (59 tests) |

## Tests

From the repository root:

```powershell
npx playwright test BurgerTime/tests/
```
