# Tapper

You are the barkeep at *The Thirsty Canvas*, working four bars at once. Built
with plain HTML5 canvas and JavaScript — no build step, no dependencies.

Customers walk in at the far end of each bar and head for your taps. Slide a
full mug down the counter to shove them back, then be standing at the right bar
to catch the empty they send back. Miss anything and it costs you a life.

![Tapper screenshot](screenshot.png)

## How to play

Open `index.html` in any modern browser. Press **Space** (or click **Start
Shift**) to begin.

| Key | Action |
|---|---|
| ↑ / W | Move up one bar |
| ↓ / S | Move down one bar |
| Space | Start the shift — and pour a mug while playing |
| P | Pause / resume |

### The three ways to lose a life

- **GRABBED!** — a customer reached your taps.
- **MUG SPILLED!** — you poured a mug on a bar with nobody to take it, and it ran
  off the far end. Do not pour speculatively.
- **MUG SMASHED!** — a customer sent an empty back and you were on another bar.

### Scoring

| Event | Points |
|---|---|
| A customer catches your mug | 50 |
| A customer pushed off the far end (served) | 150 |
| An empty caught at the taps | 100 |
| Clearing a wave | 300 × level |

- Each mug a customer drinks makes them **thirstier**: they come back faster and
  their coat reddens. Stalling on the same customer for easy points will
  eventually put them at your taps before you can stop them.
- A wave needs `4 + 2 × level` customers served. Clear it and the next level
  starts: more customers, arriving sooner, walking faster.
- Your best score is kept in the browser's `localStorage`.

## Development

Tapper follows the repo-wide test setup. From the repository root:

```powershell
npm install
npx playwright install chromium
npx playwright test Tapper/tests/
```

`tests/tapper.spec.js` drives the simulation directly through `step(dt)` rather
than waiting on the animation loop, so the specs are deterministic.

See [DESIGN.md](DESIGN.md) for how the code is put together and why the game is
balanced the way it is.
