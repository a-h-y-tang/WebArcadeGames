# Curling

A turn-based curling match against the computer, built with plain HTML5 canvas
and JavaScript — no build step, no dependencies. Slide your stones up the sheet,
curl them around guards, and finish closer to the button than the CPU.

![Curling screenshot](screenshot.png)

## How to play

Open `index.html` in any modern browser. Press **Space** (or click **Start
Game**) to begin.

| Input | Action |
|---|---|
| ← / → | Aim left / right |
| ↑ / ↓ | Add / take off weight |
| H | Switch the handle (in-turn ↔ out-turn) |
| Space | Throw the stone |
| Mouse move | Aim at the pointer |
| Click | Throw at the pointer |
| Space (between ends) | Move on to the next end |

You throw **red**, the computer throws **yellow**. Each team has four stones per
end, and the match runs for four ends.

### The three things you choose

- **Weight** — how hard the stone is thrown. Too light and it never reaches the
  hog line (the red line) and is swept off; too heavy and it slides straight
  through the back of the house and out of play. Draw weight to the button sits
  around 70 %.
- **Line** — where you aim. The dashed guide shows where the stone would finish
  if nothing were in its way, curl included.
- **Handle** — which way the stone rotates. An **in-turn** curls to the right on
  its way down, an **out-turn** curls to the left. Aim wide and let the curl
  bring the stone back in behind a guard.

### Scoring

When all eight stones have been thrown, the team with the stone closest to the
button scores **one point for each of its stones lying closer than the
opponent's best**. Only stones touching the blue twelve-foot ring count; the
current shot rock is circled in black.

If nobody is in the house the end is **blank** and nobody scores. The team that
scores throws first in the next end, which means giving up the **hammer** — the
last stone of the end, and the best chance to score. The computer has the hammer
in end 1.

Highest total after four ends wins.

### Tactics worth knowing

- A stone parked short of the house is a **guard**: it cannot score, but the
  computer has to come around it to reach the button.
- A heavy stone aimed at an opposing rock is a **takeout** — hit it and it slides
  out of play, and yours may well stay.
- Sitting one point up without the hammer is a good place to be. Sitting one
  point down with it is better.

## Development

Curling follows the repo-wide test setup. From the repository root:

```powershell
npm install
npx playwright install chromium
npx playwright test Curling/tests/
```

See [DESIGN.md](DESIGN.md) for how the physics, the scoring and the computer
opponent work, and for the assumptions made while building it.
