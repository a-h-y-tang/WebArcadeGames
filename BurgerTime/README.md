# Burger Time

A platform-and-ladder arcade game built with plain HTML5 canvas and JavaScript —
no build step, no dependencies. Run **Chef Pepper** along five platforms and
knock burger ingredients down onto the plates below while three hungry foods
chase you around the kitchen.

Inspired by the 1982 Data East arcade classic.

![Burger Time screenshot](screenshot.png)

## How to play

Open `index.html` in any modern browser. Press **Enter** (or click **Start
Game**) to begin.

| Key | Action |
|---|---|
| ← / → / A / D | Run along a platform |
| ↑ / ↓ / W / S | Climb a ladder |
| Space | Throw pepper (also starts the game and advances a cleared level) |
| P | Pause / resume |
| Enter | Start / restart |

- **Walk the whole length of an ingredient** — all four of its tiles — to knock
  it down one platform. It lands on the platform below, and anything already
  resting there is knocked down another level in turn.
- An ingredient that reaches the **plate** at the bottom stays there. Four
  ingredients on a plate is a finished burger; four burgers clears the level.
- A knocked-down ingredient has to be walked again from scratch, so plan the
  route rather than pacing back and forth.
- **Hot dogs, eggs and pickles** hunt you along the same platforms and ladders.
  Touching one costs a life; you start with three.
- **Pepper** (Space) throws a cloud in front of you that freezes anything caught
  in it for a few seconds — stunned enemies are safe to walk past. You get five
  peppers per level, so save them for a corner you cannot run out of.
- A **falling ingredient squashes** any enemy standing on it — worth 100 points
  and a few seconds of breathing room while it respawns.
- Each level cleared speeds the enemies up and adds another one, up to five.
- Your best score is saved in the browser's `localStorage`.

## Scoring

| Event | Points |
|---|---|
| Ingredient lands | 50 |
| Enemy squashed | 100 |
| Burger completed | 500 |
| Level cleared | 1000 × level |

## Development

Burger Time follows the repo-wide test setup. From the repository root:

```powershell
npm install
npx playwright install chromium
npx playwright test BurgerTime/tests/
```

The tests drive the simulation through the same `step(dt)` function the frame
loop uses, so they are deterministic and never wait on animation timing. See
[DESIGN.md](DESIGN.md) for how the code is put together.
