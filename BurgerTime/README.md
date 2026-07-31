# Burger Time

A single-screen platform arcade game, built with plain HTML5 canvas and
JavaScript — no build step, no dependencies. You are a chef loose on a maze of
girders and ladders, and the burgers are hanging above you in pieces. Walk the
full length of an ingredient and it drops to the girder below; walk it all the
way down and it lands on the plate. Assemble all four burgers to clear the
level — while a hot dog, a fried egg and a pickle chase you around the screen.

Inspired by the 1982 Data East arcade classic.

![Burger Time screenshot](screenshot.png)

## How to play

Open `index.html` in any modern browser. Press **Space** (or click **Start
Game**) to begin.

| Key | Action |
|---|---|
| ← / → (or A / D) | Walk along a girder |
| ↑ / ↓ (or W / S) | Climb a ladder |
| Space | Throw pepper — also starts / restarts the game |
| P | Pause / resume |

- Every ingredient is **four slices wide**. Each slice you step on sags; step on
  all four and the whole ingredient breaks loose and falls one girder. Each drop
  scores **50 points**.
- An ingredient that lands on another one **knocks it loose too** and bounces on
  past it, so a single drop can ripple through a whole stack — worth 50 points per
  piece it knocks loose. Pieces still land a girder at a time, so a cascade gets
  the burger most of the way down, not all of it.
- A falling ingredient **squashes any enemy under it**: 100 points for the first,
  doubling for each extra enemy caught in the same drop.
- Touching an enemy costs a chef. You get **3**, plus a moment of invulnerability
  after each loss.
- **Pepper** (5 shakes, +2 each new level) freezes every enemy in the cloud for 3
  seconds. Enemies are always slower than you, so pepper is for escaping corners.
- Plating all 16 ingredients clears the level: **1000 bonus points**, then the
  burgers are restocked with more and faster enemies.
- Your best score is saved in the browser's `localStorage`.

## Development

Burger Time follows the repo-wide test setup. From the repository root:

```powershell
npm install
npx playwright install chromium
npx playwright test BurgerTime/tests/
```

The 75-test suite covers the level layout, chef walking and climbing, segment
stepping, falling and chaining, plating, pepper, enemy chasing, squashing, lives,
level progression, pausing and the HUD.

See [DESIGN.md](DESIGN.md) for how the code is structured and how the simulation
is made deterministic for testing.
