# Mini Golf

A top-down putting game. Aim, set your power, and putt the ball across a
walled green toward the cup. The ball rolls under friction and bounces off
the walls and wooden obstacles; it drops in when it reaches the cup slowly
enough. Sink all the holes in as few strokes as you can — a lower total is a
better score.

## How to play

Open `index.html` directly in any modern browser — no build step or server
required.

### Controls

| Input | Action |
|---|---|
| **Mouse drag** | Pull back from the ball to aim and set power (slingshot); release to putt |
| **← / →** or **A / D** | Rotate the aim left / right |
| **↑ / ↓** or **W / S** | Increase / decrease power |
| **Space** | Putt (also starts the game and resumes from pause) |
| **P** | Pause / resume |
| **Start button** | Start or restart the course |

### Goal

- Putt the ball into the **cup** on each hole. The ball only drops in if it
  arrives slowly enough — a putt at full pace rolls over the lip.
- The ball bounces off the boundary and off the **wooden obstacles**, so use
  the walls to your advantage.
- Sinking a hole moves you to the next tee; sink the **last** hole to finish
  the course.
- Your score is the **total strokes** across all holes, measured against the
  course **par**. Your best (lowest) total is saved in the browser
  (`localStorage`) and shown in the HUD.

## Files

| File | Purpose |
|---|---|
| `index.html` | Page markup — canvas, HUD and overlay |
| `style.css` | Styling / dark golf-green theme |
| `game.js` | All game logic, physics and rendering |
| `tests/minigolf.spec.js` | Playwright test suite |
| `DESIGN.md` | Design notes, mechanics and assumptions |

## Development

From the repository root:

```powershell
npm install
npx playwright install chromium   # first time only
npx playwright test MiniGolf/tests/
```

See [`DESIGN.md`](DESIGN.md) for the mechanics, state machine and the
testable surface (`step(dtMs)`, `startGame()`, `shoot()`, `loadHole()`, …)
that makes the physics deterministic and the courses reproducible, so the
whole game can be driven from tests.
