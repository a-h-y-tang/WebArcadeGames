# Marble Chain

A spiral marble shooter, built with plain HTML5 canvas and JavaScript — no build
step, no dependencies. A chain of coloured marbles crawls along a spiral track
towards the hole in the middle of the board. You sit at the centre in a rotating
shooter and fire marbles into the chain: line up **three or more of a colour**
and they pop. Clear every marble in the level before the head of the chain
reaches the hole.

Inspired by *Puzz Loop* and *Zuma*.

![Marble Chain screenshot](screenshot.png)

## How to play

Open `index.html` in any modern browser. Press **Space** (or click **Start
Game**) to begin.

| Input | Action |
|---|---|
| Mouse move | Aim the shooter at the pointer |
| ← / → | Rotate the aim (hold to sweep) |
| Click | Aim at the pointer and shoot |
| Space | Start / restart, or shoot while playing |
| S | Swap the current and next marble |
| P | Pause / resume |

- Shots slot into the chain **where they land** — either side of the marble they
  touch — so aim at the seam you want, not just at a colour.
- A run of **three or more** matching marbles pops. The marbles behind snap
  forward to close the gap, and if that creates another run it pops too: a
  **combo**, worth progressively more each step of the cascade.
- A pop scores `10 × marbles × level × combo step`, so long runs and cascades on
  later levels are where the points are.
- The shooter only ever hands you a colour that is still on the track, and you
  can press **S** to swap it with the one on deck.
- Clear the level's whole supply of marbles to advance. Each level crawls faster
  and adds colours (three at first, up to six).
- If the head of the chain reaches the hole, it's game over. Your best score is
  saved in the browser's `localStorage`.

## Development

Marble Chain follows the repo-wide test setup. From the repository root:

```powershell
npm install
npx playwright install chromium
npx playwright test MarbleChain/tests/
```

See [DESIGN.md](DESIGN.md) for how the code is structured, how the spiral and
chain are modelled, and how the simulation is made deterministic for testing.
