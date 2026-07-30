# Burger Time

Build four burgers by stomping their ingredients down a maze of girders and
ladders — while three hungry food enemies chase you around the kitchen.

![Burger Time](screenshot.png)

## How to play

Open `index.html` in any modern browser. No build step, no server.

1. Walk the chef across the **full width** of an ingredient. Each of its four
   segments dips as you pass over it.
2. When all four segments are pressed, the ingredient falls **one floor**.
3. Repeat until the ingredient lands on the plate at the bottom of its column.
4. Plate all four ingredients in all four columns to clear the level.

An ingredient that lands on another one knocks it loose too, so a well-placed
drop can cascade a whole stack onto the plate at once.

### Enemies

Hot dogs, eggs and pickles walk the girders and climb the ladders after you.
Touching one costs a chef. Two ways to fight back:

- **Drop an ingredient on them.** Any enemy standing on an ingredient rides it
  down and is squashed when it lands. Squashing several in one chain scores more.
- **Throw pepper** (Space). The cloud stuns everything it touches for a few
  seconds. You start each level with five shakers.

Each level reuses the same kitchen, but the enemies get faster and more numerous.

## Controls

| Input | Action |
|---|---|
| <kbd>←</kbd> <kbd>→</kbd> / <kbd>A</kbd> <kbd>D</kbd> | Walk |
| <kbd>↑</kbd> <kbd>↓</kbd> / <kbd>W</kbd> <kbd>S</kbd> | Climb a ladder |
| <kbd>Space</kbd> | Throw pepper (also starts the game) |
| <kbd>Enter</kbd> | Start / restart |
| <kbd>P</kbd> | Pause / resume |

## Scoring

| Event | Points |
|---|---|
| Ingredient dropped one floor | 50 |
| Ingredient plated | 100 |
| Enemy squashed | 100 (x its place in the chain) |
| Enemy peppered | 50 |
| Level cleared | 1000 |

Your best score is remembered in `localStorage`.

## Files

| File | Purpose |
|---|---|
| `index.html` | Canvas, HUD and overlay markup |
| `style.css` | Diner-themed styling |
| `game.js` | All game logic and rendering |
| `DESIGN.md` | How the code works and what was assumed |
| `tests/burgertime.spec.js` | Playwright test suite |

## Tests

From the repository root:

```powershell
npx playwright test BurgerTime/tests/
```
