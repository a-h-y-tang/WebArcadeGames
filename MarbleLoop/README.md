# Marble Loop

A path-based marble shooter. A chain of coloured marbles crawls along a winding
track toward a pit at the end of the line. You sit on a turret in the middle of
the track and fire marbles into the chain — land three or more of a colour in a
row and they pop.

Open `index.html` in any browser. No build step, no server.

## How to play

- **Aim** with the mouse.
- **Fire** with a click or <kbd>Space</kbd>.
- **Swap** the loaded marble with the one queued behind it with <kbd>S</kbd> —
  useful when the colour you need is next rather than now.
- <kbd>P</kbd> pauses, <kbd>R</kbd> restarts.

Clear every marble on the track — including the ones still waiting to roll on —
and the next level begins with a new track, more marbles and a faster crawl. If
the head of the chain reaches the pit, the run is over.

## Scoring

Each popped marble is worth 10 points. When one shot causes several pops in a
row — the marbles behind roll forward, close the gap, and complete another run —
the multiplier climbs with each pop in the cascade: 1×, then 2×, then 3×. Setting
up a cascade is worth far more than three flat pops.

Your best score is kept in the browser's local storage.

## Tracks

Levels cycle through three layouts:

1. **Spiral** — the turret sits in the eye of the spiral and the pit is right
   beside it.
2. **Serpentine** — three sweeps across the screen, turret below the bottom row.
3. **Oval** — a near-closed loop with the turret in the middle.

## Under the hood

See [DESIGN.md](DESIGN.md) for the arc-length parameterised track, the chain
marching and gap-closing rules, and the insertion maths.

## Tests

From the repository root:

```powershell
npx playwright test MarbleLoop/tests/
```
