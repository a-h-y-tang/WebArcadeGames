# Tapper

A lane-based bar-serving arcade game, built with plain HTML5 canvas and
JavaScript — no build step, no dependencies. You work **four bars at once**:
thirsty customers shuffle in from the doors and head for the taps, and you slide
mugs down the bar to push them back out again. Empty mugs come sliding back —
catch them or they smash.

Inspired by the 1983 arcade classic.

![Tapper screenshot](screenshot.png)

## How to play

Open `index.html` in any modern browser. Press **Space** (or click **Start
Game**) to begin.

| Key | Action |
|---|---|
| ↑ / W | Move up one bar |
| ↓ / S | Move down one bar |
| Space | Pour a mug (starts / restarts the game when not playing) |
| Click | Pour a mug |
| P | Pause / resume |

- **Serve customers** by pouring a mug down their bar. A customer who catches
  one drinks and is pushed back toward the door.
- **Push a customer out of the door** to score big — they send their empty mug
  back down the bar as they go.
- **Catch the empties** by standing at that bar as the mug reaches the tap end.
- You lose a life if a mug nobody catches reaches the end of a bar, if an empty
  mug slides past you, or if a customer reaches the taps and grabs you. Every
  mistake clears the bars.
- Serve **6 customers** to clear a level. Each level speeds up the crowd, the
  mugs and the arrivals, awards a bonus life (up to 5), and pays more points.
- You start with 3 lives. Your best score is saved in the browser's
  `localStorage`.

## Development

Tapper follows the repo-wide test setup. From the repository root:

```powershell
npm install
npx playwright install chromium
npx playwright test Tapper/tests/
```

See [DESIGN.md](DESIGN.md) for how the code is structured and how the simulation
is made deterministic for testing.
