# Rally-X

A scrolling maze chase. Drive the blue rally car through the maze, collect all
ten checkpoint flags before the tank runs dry, and shake off the red pursuit
cars with a well-timed smoke screen.

Open `index.html` in a browser — no build step or server required.

## How to play

- **Steer** with the arrow keys or `WASD`. The car keeps driving in the last
  direction you asked for and takes a turn as soon as one opens up, so you can
  set up a corner before you reach it.
- **Collect all ten flags** to clear the level. One flag on every map is the
  **lucky flag** (pink, flashing): grab it early and every flag after it is worth
  double.
- **Drop a smoke screen** with `Space`. It costs 6 fuel and spins out any pursuer
  that drives into it for two and a half seconds — long enough to slip past.
- **Watch the fuel.** It drains all the time and running dry costs a life, so a
  smoke screen you don't need is a lap you don't get.
- **Pause** with `P`.

The radar beside the maze shows the whole level at once: your car in blue,
pursuers in red, flags in yellow (the lucky one in pink), and the white rectangle
is the part of the maze currently on screen.

## Controls

| Input | Action |
|---|---|
| Arrow keys / `WASD` | Steer |
| `Space` | Drop a smoke screen (6 fuel) |
| `P` | Pause / resume |
| `Enter` or `Space` | Start, or restart after game over |

## Scoring

| Event | Points |
|---|---|
| Flag | 100 (200 after the lucky flag) |
| Level cleared | 5 × the fuel left in the tank |

Clearing a level with a full-ish tank is worth more than five flags, so the fast
line through the maze pays. Your best score is remembered in the browser.

## Difficulty

Every level generates a new maze. Level 1 fields three pursuers at 74 px/s; each
level adds one (up to five) and 4 px/s (up to 90 px/s) — always a little slower
than your car, so the maze and the smoke screen decide the chase.

## Under the hood

See [DESIGN.md](DESIGN.md) for the maze generator, the tile-to-tile movement
model, the pursuer AI and the assumptions behind the rules.

## Tests

```powershell
npx playwright test RallyX/tests/
```
