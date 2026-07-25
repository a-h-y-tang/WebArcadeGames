# Road Rush

A top-down endless highway dodger built with HTML5 Canvas. Weave your car
through oncoming traffic and drive as far as you can — the road only gets faster.

## How to Play

Open `index.html` in any modern browser — no build step, no dependencies.

| Input | Action |
|---|---|
| ← / → or A / D | Change lanes |
| Space, arrows, or A / D | Start or restart |
| P | Pause / resume |

**Objective:** Your car sits at the bottom of a four-lane road while traffic
streams toward you. Hop between lanes to slip through the gaps. A single
collision ends the run.

**Scoring:** Your score is the distance travelled. The road speed ramps up the
farther you go, so traffic comes at you faster and faster.

**Game over:** Hit any car and the run is over.

Your best distance is saved in `localStorage` and persists between sessions.

## Files

| File | Purpose |
|---|---|
| `index.html` | Page markup: canvas, HUD, and the start/pause/game-over overlay |
| `style.css` | Dark neon theme and layout |
| `game.js` | Game logic: lane movement, traffic, scoring, collision, rendering |
| `DESIGN.md` | How the game and its code work |
| `tests/` | Playwright test suite |

## Running the tests

From the repository root:

```powershell
npx playwright test RoadRush/tests/
```

See the root `README.md` for full setup instructions.
