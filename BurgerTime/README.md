# BurgerTime

A ladders-and-platforms arcade game, built with plain HTML5 canvas and
JavaScript — no build step, no dependencies. Run the chef across five floors and
stomp burger ingredients down onto the plates below, while hot dogs, eggs and
pickles chase you through the maze.

Inspired by the 1982 Data East coin-op.

![BurgerTime screenshot](screenshot.png)

## How to play

Open `index.html` in any modern browser. Press **Space** (or click **Start
Game**) to begin.

| Key | Action |
|---|---|
| ← / → or A / D | Walk along a floor |
| ↑ / ↓ or W / S | Climb a ladder |
| Space | Start the game / throw pepper |
| P | Pause / resume |

- **Walk the whole width of an ingredient** to knock it down a level. Half a
  pass does nothing — all four segments have to be pressed.
- A falling pile that lands on another pile **shoves it down too**, so one good
  run down a fresh column cascades the bun, lettuce, patty and base all the way
  to the bottom floor together. One more pass sends them onto the plate.
- Finish all four burgers to clear the level. Each ingredient landed is worth
  **50** points and clearing the level is worth **1000**.
- **Pepper** (Space) freezes nearby enemies for a few seconds. You get five
  shakers per level, refilled when you advance — spend them when you're cornered.
- An enemy standing on an ingredient when it drops **rides it down and is
  squashed**, worth **500** points. Luring one onto a burger you're about to
  stomp is the fastest way to score.
- Touching a moving enemy costs a chef. You get three, and your burger progress
  survives — you restart at the bottom of the board, not the level.

Enemies get faster and more numerous every level. Your best score is remembered
in the browser.

## Layout notes

The two outer ladders run the full height of the board; the three middle ones
have rungs missing, so plotting a route up and back down is part of the game.

## Development

Tests live in `tests/` and run with Playwright from the repository root:

```powershell
npx playwright test BurgerTime/tests/
```

See [DESIGN.md](DESIGN.md) for how the code is put together.
