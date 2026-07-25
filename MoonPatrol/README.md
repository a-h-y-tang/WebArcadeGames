# Moon Patrol

A side-scrolling arcade game inspired by Irem's 1982 classic. Drive a moon
buggy across the lunar surface, jumping craters and rocks while blasting the
rocks ahead of you and the UFOs above.

![screenshot](screenshot.png)

## How to play

- **Space / ↑ / W** — jump.
- **F / ↓ / S** — fire (one press shoots forward *and* upward).
- **Enter** — start / restart.
- **P** — pause / resume.

The world scrolls past at an ever-increasing pace. Jump the craters (you can't
shoot those), and either jump or blast the rocks. UFOs swoop down from above —
knock them out with your upward shot before they reach you. Distance travelled
and enemies destroyed both add to your score. Every crash costs one of your
three buggies; lose them all and the patrol is over.

## Files

| File | Purpose |
|---|---|
| `index.html` | Page markup: canvas, HUD, start/pause/over overlay. |
| `style.css` | Styling for the frame, HUD and overlay. |
| `game.js` | All game state and logic; the deterministic `step(dt)` simulation and the real-time render loop. |
| `DESIGN.md` | Design notes: concept, mechanics, architecture, assumptions. |
| `tests/moonpatrol.spec.js` | Playwright test suite. |

## Running the tests

From the repository root:

```powershell
npx playwright test MoonPatrol/tests/
```

See the repository root `README.md` for full setup instructions.
