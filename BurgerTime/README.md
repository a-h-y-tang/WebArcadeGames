# Burger Time

A single-screen arcade platformer built with plain HTML5 canvas and JavaScript —
no build step, no dependencies. You are **Chef Pierre**, stranded on a scaffold
of girders and ladders that holds four half-built hamburgers. Walk the full
width of an ingredient and it drops a floor. Walk every ingredient all the way
down to the plates and the burgers are served.

Meanwhile a hot dog, a fried egg and a pickle are chasing you across the
girders. One touch costs a life.

Inspired by Data East's 1982 arcade classic *BurgerTime*.

![Burger Time screenshot](screenshot.png)

## How to play

Open `index.html` in any modern browser. Press **Enter** (or click **Start
Game**) to begin.

| Key | Action |
|---|---|
| ← / → / A / D | Walk left or right along a girder |
| ↑ / ↓ / W / S | Climb a ladder (only while lined up with one) |
| Space | Throw pepper |
| Enter | Start / restart |
| P | Pause / resume |

### Dropping ingredients

Each ingredient is three tiles wide. Standing on a tile presses it down; press
all three and the ingredient falls to the girder below. If something is already
resting there, it gets knocked loose too — and that can chain all the way down
the stack, so a well-timed drop from the top does a lot of work at once. An
ingredient that reaches the bottom lands on the plate and is finished; anything
that stops on an intermediate girder has to be walked across again.

### Staying alive

- Touching an enemy costs one of your three lives and sends everyone back to
  their starting marks. Your progress on the burgers is kept.
- **Pepper** (Space) throws a cloud into the tile in front of you. Anything
  caught in it freezes for a few seconds and is harmless to touch. You get five
  shakers per game and they are *not* refilled between levels — use them.
- The best weapon is free: drop an ingredient on an enemy and it is flattened.
  Each extra enemy caught in the same fall is worth double the last, so three at
  once pays 700.

### Scoring

| Event | Points |
|---|---|
| Ingredient dropped (including chain knocks) | 50 |
| Enemy squashed (*n*th in one fall) | 100 × 2ⁿ |
| Level cleared | 1000 |

Clearing a level rebuilds the burgers and brings on faster — and eventually more
— enemies. Your best score is saved in the browser's `localStorage`.

## Development

Burger Time follows the repo-wide test setup. From the repository root:

```powershell
npm install
npx playwright install chromium
npx playwright test BurgerTime/tests/
```

See [DESIGN.md](DESIGN.md) for how the code is structured, how the simulation is
made deterministic for testing, and the assumptions made along the way.
