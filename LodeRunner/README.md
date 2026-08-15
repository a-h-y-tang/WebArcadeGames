# Lode Runner

A dig-and-collect platform puzzler built with plain HTML5 canvas and
JavaScript — no build step, no dependencies. Sweep every gold bar off the
girders while guards hunt you across the level, then climb out the top.

![Lode Runner screenshot](screenshot.png)

## How to play

Open `index.html` in any modern browser. Press **Space** (or click **Start
Run**) to begin.

| Key | Action |
|---|---|
| ← / → or A / D | Run, and move along a rope |
| ↑ / ↓ or W / S | Climb a ladder, or drop off a rope |
| Z or `,` | Dig the brick down and to your left |
| X or `.` | Dig the brick down and to your right |
| Space | Start, or restart after a game over |
| P | Pause / resume |

- Collect **every gold bar** on the level and the **escape ladder** appears in
  green. Climb it to the top row to move on. 100 points a bar, 500 for the
  level.
- You have **no weapon**. The drill is the whole game: open a hole in the
  brickwork and the guard chasing you drops in and flounders for a few
  seconds. Run across their head while they are down there.
- **Holes heal over** after about five seconds, and whatever is standing in one
  when it closes is crushed — a guard respawns at its start, and you lose a
  life. That includes holes you dug for yourself, so do not linger in one.
- You **cannot steer while falling**, and you cannot dig from a ladder, from a
  rope, or in mid-air. Solid grey stone cannot be drilled at all.
- Three levels, three lives. Your best score is saved in the browser's
  `localStorage`.

## Development

Lode Runner follows the repo-wide test setup. From the repository root:

```powershell
npm install
npx playwright install chromium
npx playwright test LodeRunner/tests/
```

See [DESIGN.md](DESIGN.md) for how the tile-locked motion, the guard routing
and the level format work — and for the assumptions behind the rules.
