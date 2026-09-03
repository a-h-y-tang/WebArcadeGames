# Tapper

Four bars. One bartender. A great many thirsty people.

Customers push through the swing doors at the right of each bar and shuffle
toward your taps. Slide a full mug down their bar to knock them back a step —
knock them all the way out of the door and they're served. Then watch out: every
served customer sends their empty mug rolling back down the bar, and if you
aren't standing there to catch it, it hits the floor.

![Tapper](screenshot.png)

## Playing

Open `index.html` in any browser — no build step, no server.

| Input | Action |
|---|---|
| `↑` / `W` | move up one bar |
| `↓` / `S` | move down one bar |
| `Space` | pour a mug (also starts and restarts the game) |
| `P` | pause / resume |
| Click a bar | jump to that bar and pour |

## Rules

* You have **three bartenders**. You lose one when:
  * a customer reaches your end of the bar,
  * a mug slides off the far end without hitting anyone,
  * an empty mug comes back and nobody is there to catch it.
* Losing a bartender clears the bar and the shift picks up where it left off.
* **Serving** a customer scores **100**. **Catching** an empty scores **50**.
* Each shift asks for more customers than the last one, and they walk faster.
  Clear the quota with the bar empty and the next shift starts.
* Your best score is kept in the browser between visits.

## Tips

* A mug shoves a customer back a fixed distance, so a customer who has just come
  through the door needs several mugs — start on them early.
* Pouring is nearly free; walking is not. Watch which bar the next empty will
  come back down before you commit.
* Two mugs already sliding down a bar are usually enough. A third is how you end
  up spilling one off the far end.

## Development

The whole game is `index.html`, `style.css` and `game.js` — plain, buildless
JavaScript. `DESIGN.md` explains how the code fits together.

Tests are Playwright specs in `tests/`, run from the repository root:

```powershell
npx playwright test Tapper/tests/
```
