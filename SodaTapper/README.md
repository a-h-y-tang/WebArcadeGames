# Soda Tapper

![Soda Tapper](screenshot.png)

Four counters. One bartender. A room full of people who want a drink *now*.

Slide full mugs down a counter to push customers back toward the door, and catch
the empties they shove back at you before they smash on the floor.

## How to play

Open `index.html` in a browser — no build step, no server.

| Input | Action |
|---|---|
| <kbd>↑</kbd> / <kbd>W</kbd> | Move up one counter |
| <kbd>↓</kbd> / <kbd>S</kbd> | Move down one counter |
| <kbd>Space</kbd> | Slide a mug down the current counter (also starts the game) |
| <kbd>P</kbd> | Pause / resume |

## Rules

- Customers walk in through the door on the left and advance toward you.
- A full mug that reaches a customer gets caught: they stagger back a few steps,
  drink, and slide the empty mug back toward you.
- Push a customer all the way back to the door and they go home happy.
- **You lose a life** when:
  - an empty mug reaches your end of a counter you are not standing at,
  - a full mug reaches the far end of a counter with nobody to catch it,
  - a customer reaches your end of the bar.
- Three lives. Clear every customer on a shift to move on to the next one —
  more of them, arriving faster, walking quicker.

## Scoring

| Event | Points |
|---|---|
| Customer catches a mug | 50 |
| You catch an empty mug | 25 |
| Customer pushed out of the door | 100 |

Your best score is kept in the browser's `localStorage`.

## Files

| File | Purpose |
|---|---|
| `index.html` | HUD, canvas and overlay markup |
| `style.css` | Arcade cabinet styling |
| `game.js` | Simulation (`step`), rendering (`draw`) and input |
| `DESIGN.md` | How the code works, and the assumptions behind it |
| `tests/sodatapper.spec.js` | Playwright suite (55 tests) |

## Tests

From the repository root:

```powershell
npx playwright test SodaTapper/tests/
```

The specs set `autoStep = false` and call `step(dt)` themselves, so every
scenario is frame-exact and independent of the real animation loop.
