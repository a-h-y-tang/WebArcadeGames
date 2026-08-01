# BurgerTime

A platform-and-ladder arcade game on an HTML5 canvas. Run the girders, stomp
the ingredients down onto their plates, and keep the hot dogs off your back.

![BurgerTime](screenshot.png)

## Playing

Open `index.html` in any browser — no build step or server required.

## Controls

| Input | Action |
|---|---|
| `←` `→` or `A` `D` | Walk along a girder |
| `↑` `↓` or `W` `S` | Climb a ladder |
| `Space` | Throw pepper (also starts a game from the title screen) |
| `P` | Pause / resume |

## How to play

Four half-built burgers hang over four plates. **Walk the full width of an
ingredient** — all four tiles of it — and it drops one level. Bury every
ingredient of every burger on its plate to clear the level.

The trick is the cascade. An ingredient that lands on another knocks that one
loose too, and rides down on top of it. Since the four ingredients of a burger
start on four consecutive girders, one clean run down a burger collapses the
whole thing onto the bottom girder as a stack — then one more walk buries it on
the plate.

Hot dogs, eggs and pickles hunt you across the scaffold. One touch costs a
chef. You have two answers:

- **Pepper** (`Space`) makes anything in front of you sneeze for a few seconds.
  Five shakes per level, so spend them when you are cornered.
- **Squash them.** An enemy standing on an ingredient when it drops rides it
  down and is flattened. That is worth 100 points — and 200, 400, 800 for each
  extra enemy caught by the same drop, which is where the big scores live.

## Scoring

| Event | Points |
|---|---|
| Ingredient knocked down | 50 |
| Enemy squashed | 100, doubling per extra enemy in the same drop |
| Level cleared | 500 |

Every level adds another enemy (up to five) and makes them faster. Your best
score is kept in the browser's local storage.

## Development

See [DESIGN.md](DESIGN.md) for how the code works.

Tests live in `tests/` and run with the repo-wide Playwright setup:

```powershell
npx playwright test BurgerTime/tests/
```
