# Asteroids

A wrap-around vector shooter. Pilot a triangular ship through a field of
drifting space rocks, blast them into ever-smaller fragments, and survive as
long as you can. The play field wraps around all four edges — fly off one side
and you reappear on the other.

## How to play

Open `index.html` directly in any modern browser — no build step or server
required.

### Controls

| Key | Action |
|---|---|
| **← / →** or **A / D** | Rotate the ship left / right |
| **↑** or **W** | Thrust forward |
| **Space** | Fire (also starts the game from the title / game-over screen) |
| **P** | Pause / resume |
| **Start button / Space / arrow / WASD** | Start or restart |

### Goal

- Shoot asteroids to score. **Large** rocks split into two **medium** rocks,
  medium into two **small**, and small ones are vaporised outright. Smaller
  rocks are worth more points (large 20 · medium 50 · small 100).
- Clear every asteroid to advance to the next **wave** — each wave adds another
  large rock and drifts a little faster.
- Flying into a rock costs a life. You start with **3**; after a hit the ship
  respawns at the centre with a brief moment of invulnerability (it blinks).
  Lose your last life and it's game over.
- Your best score is saved in the browser (`localStorage`) and shown in the HUD.

## Files

| File | Purpose |
|---|---|
| `index.html` | Page markup — canvas, HUD and overlay |
| `style.css` | Styling / dark vector-arcade theme |
| `game.js` | All game logic, physics and rendering |
| `tests/asteroids.spec.js` | Playwright test suite |
| `DESIGN.md` | Design notes, mechanics and assumptions |

## Development

From the repository root:

```powershell
npm install
npx playwright install chromium   # first time only
npx playwright test Asteroids/tests/
```

See [`DESIGN.md`](DESIGN.md) for the mechanics, state machine and the testable
surface (`step(dtMs)`, `startGame()`, `fireBullet()`, `spawnAsteroid()`, …)
that makes the physics deterministic and easy to drive from tests.
