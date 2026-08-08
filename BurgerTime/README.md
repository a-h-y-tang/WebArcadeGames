# Burger Time

A ladder-and-platform arcade game built with plain HTML5 canvas and JavaScript —
no build step, no dependencies. You are a chef locked in a giant kitchen. Four
floors joined by ladders hold the layers of four unfinished hamburgers: walk the
full width of a layer to **flip** it, and it falls one floor. Keep flipping until
every layer lands on the plate at the bottom of its column.

Meanwhile a hot dog, a fried egg and a pickle are hunting you. Stun them with
**pepper**, squash them under falling layers, or run.

Inspired by the 1982 Data East classic *BurgerTime*.

![Burger Time screenshot](screenshot.png)

## How to play

Open `index.html` in any modern browser. Press **Space** (or click **Start
Game**) to begin.

| Key | Action |
|---|---|
| ← / → (or A / D) | Walk left / right |
| ↑ / ↓ (or W / S) | Climb up / down a ladder |
| Space | Throw pepper (also starts / restarts the game) |
| P | Pause / resume |

### Flipping burgers

- Each layer is split into **four segments**. Standing on a segment flips it;
  when all four are flipped the layer drops one floor.
- A layer that lands on a floor has its segments **reset**, so you have to walk
  it again. A layer that lands on a plate is finished.
- A layer landing on a floor that already holds one **bumps** it onward, so a
  single well-aimed drop can cascade a whole column down to the plate at once.
- Plate all sixteen layers to clear the level.

### Staying alive

- Touching a monster costs one of your three chefs and sends everyone back to
  their starting spots — your burger progress is kept.
- **Pepper** stuns a monster for four seconds. A stunned monster can be walked
  straight over. You get five shakes per level.
- A falling layer **squashes** any monster under it: 500 points for the first,
  1000 for the second caught by the same layer, and so on. Squashed monsters
  come back after a few seconds.

### Scoring

| Event | Points |
|---|---|
| Layer lands on a floor | 50 |
| Layer lands on a plate | 150 |
| Monster stunned with pepper | 100 |
| Monster squashed | 500 × how many that layer has flattened |
| Level cleared | 1000 × level |

Each level adds another monster (up to five) and makes them faster. Your best
score is saved in the browser's `localStorage`.

## Development

Burger Time follows the repo-wide test setup. From the repository root:

```powershell
npm install
npx playwright install chromium
npx playwright test BurgerTime/tests/
```

See [DESIGN.md](DESIGN.md) for how the code is structured, how the simulation is
kept deterministic for testing, and which simplifications were made against the
arcade original.
