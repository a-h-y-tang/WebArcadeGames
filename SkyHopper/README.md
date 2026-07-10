# Sky Hopper

An endless vertical bouncing platformer. Your hopper springs upward every time
it lands on a platform — you just steer left and right. Climb as high as you can
without missing a platform and dropping off the bottom of the screen.

## How to play

- The hopper bounces **automatically** whenever it lands on a platform.
- **← / →** or **A / D** — steer left and right. Fly off one edge and you
  reappear on the other.
- **Space / Enter / click** — start (or restart after a game over).
- **P** — pause / resume.
- **Green platforms** are static; **blue platforms** drift sideways and start
  appearing as you climb higher.
- Your score is how high you've climbed. It only ever goes up, and your best is
  saved between sessions.

## Playing

Open `index.html` directly in any modern browser — no build step or server
required.

## Under the hood

See [DESIGN.md](DESIGN.md) for the full design, and `game.js` for the
implementation. All game state and a deterministic `step(dtMs)` physics function
are exposed at module top level, and platform layout is produced by a seedable
PRNG, so the Playwright tests in `tests/` can drive the simulation
frame-by-frame and reproduce exact layouts.

## Tests

From the repo root:

```powershell
npx playwright test SkyHopper/tests/
```
