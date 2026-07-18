# Bubble Shooter

A classic **Bubble Shooter** (*Puzzle Bobble*) arcade game on an HTML5 canvas.
Aim the launcher, fire coloured bubbles into the honeycomb above, and match
three or more of the same colour to pop them. Bubbles left dangling with no path
to the ceiling fall away. Clear the whole board to win.

## How to play

- **Aim** by moving the mouse over the board, or nudge with the `←` / `→` arrow keys.
- **Fire** with `Space`, `Enter`, or a mouse click.
- Land **3+ same-coloured** bubbles together to pop the group.
- Popping bubbles that were holding others up drops those **floating** bubbles too —
  set up chains for big scores (drops are worth double).
- **Win** by clearing every bubble. **Lose** if a bubble settles below the red
  death line near the launcher.

Scoring: **10 points** per popped bubble, **20 points** per dropped bubble. Your
best score is saved in the browser via `localStorage`.

## Running

Open `index.html` directly in any modern browser — no build step or server needed.

## Tests

Playwright specs live in `tests/`. From the repo root:

```powershell
npx playwright test BubbleShooter/tests/
```

The tests drive the game's exposed logic (hex-grid geometry, cluster matching,
floating-bubble gravity, scoring, win/lose) deterministically. See
[`DESIGN.md`](DESIGN.md) for how the code is structured.
