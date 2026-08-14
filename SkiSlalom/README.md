# Ski Slalom

A downhill slalom race against the clock, built with plain HTML5 canvas and
JavaScript — no build step, no dependencies. You are always falling down the
hill; all you control is which way the skis point. Ski between the poles of all
**16 gates**, dodge the pines, and get to the finish line in the fastest time.

![Ski Slalom screenshot](screenshot.png)

## How to play

Open `index.html` in any modern browser. Press **Space** (or click **Start
Run**) to drop in.

| Key | Action |
|---|---|
| ← / A | Carve left |
| → / D | Carve right |
| Space | Start / restart a run |
| P | Pause / resume |
| R | Restart on a fresh course |

- **Angle is speed.** Pointed straight down the fall line you accelerate to top
  speed; the harder you carve across it, the more speed you scrub off. Getting a
  clean line with as little turning as possible is the whole game.
- **Let go to straighten up.** Release both keys and the skis drift back toward
  the fall line on their own — you never have to counter-steer out of a turn.
- **Gates alternate** blue and red either side of the centre line. Passing
  between the poles marks the gate cleared; missing one costs **3 seconds** and
  greys it out behind you.
- **Trees hurt.** Clip one and you are down for 1.2 seconds with the clock still
  running. The tree gets flattened, so it cannot catch you again as you get up.
- **The edges are deep snow.** You cannot leave the piste, and hugging the edge
  is slow — but it is a legitimate way out of a bad tree field.
- Your **final time** is the clock plus every penalty. The fastest run is saved
  in the browser's `localStorage`.

Each run generates a brand-new course, so no two races are the same.

## Development

Ski Slalom follows the repo-wide test setup. From the repository root:

```powershell
npm install
npx playwright install chromium
npx playwright test SkiSlalom/tests/
```

`DESIGN.md` explains how the code is organised, why the simulation is
deterministic, and what the tests cover.
