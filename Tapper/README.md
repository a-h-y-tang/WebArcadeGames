# Tapper

Four counters. A bar filling up with thirsty patrons. One of you.

You are the bartender, and you can only stand at the right-hand end of one
counter at a time. Patrons come in through the door at the left of each counter
and shuffle steadily toward you. Slide a mug down a counter to shove the nearest
patron back toward the door — push one all the way out and they leave happy.

The catch is that every mug you pour comes straight back at you empty. If you
have wandered off to another counter when it arrives, it sails off the end and
smashes. Serve greedily on one counter and the empties pile up behind you while
somebody creeps up on another.

## Playing

Open `index.html` in any browser — no build step or server needed.

| Key | Action |
|---|---|
| `↑` / `W` | Move up one counter |
| `↓` / `S` | Move down one counter |
| `Space` | Pour a mug down the current counter |
| `P` | Pause / resume |
| `Space` | Start (from the title screen or after game over) |

## Rules

- A full mug that reaches a patron pushes them **80 px** back toward the door
  and stops them for a moment while they drink. They immediately slide the
  **empty mug** back toward you.
- A patron pushed past the door is served: **+50**.
- A departing patron takes one mug still sliding behind them — *one for the
  road*: **+25**. So a sensible double-pour isn't punished.
- Catching an empty mug: **+10**. Missing one: **a life**.
- A mug poured down a counter with nobody on it runs off the far end: **a life**.
- A patron who reaches the right-hand end grabs you: **a life**.
- Clearing a wave: **100 × level**, and the next wave is bigger and faster.

You start with three lives. Losing one clears the whole bar and restarts the
current wave.

## How it works

`game.js` is a single classic script — all state lives in plain globals, and all
motion runs through `step(dt)` in per-second units, so the game can be simulated
frame by frame without touching the clock. `requestAnimationFrame` only computes
a `dt`, calls `step`, and draws.

See [DESIGN.md](DESIGN.md) for the full breakdown of the mechanics, the
rendering, and the assumptions behind them.

## Tests

Playwright specs live in `tests/`:

```powershell
npx playwright test Tapper/tests/
```

They drive the game through those globals — spawning patrons at chosen
positions, advancing the simulation a fixed number of frames, and asserting on
the resulting state — so every rule above is covered by a test that doesn't
depend on real time passing.
