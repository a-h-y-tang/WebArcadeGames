# Burger Time

A single-screen platform/ladder arcade game, built with plain HTML5 canvas and
JavaScript — no build step, no dependencies. You are a chef trapped on a lattice
of girders with four half-built hamburgers. Walk across an ingredient to stamp it
down; stamp every segment and it drops to the girder below, knocking whatever it
lands on down a level too. Push all four ingredients of a stack onto the plate
and the burger is served.

Meanwhile a hot dog, a fried egg and a pickle climb the girders hunting you. One
touch costs a chef. You carry a handful of pepper shakers — a puff of pepper
freezes anything caught in it — and an ingredient that falls on an enemy squashes
it flat for bonus points.

Inspired by the 1982 Data East classic.

![Burger Time screenshot](screenshot.png)

## How to play

Open `index.html` in any modern browser. Press **Space** (or click **Start
Game**) to begin.

| Key | Action |
|---|---|
| ← / A | Walk left |
| → / D | Walk right |
| ↑ / W | Climb up a ladder |
| ↓ / S | Climb down a ladder |
| Space | Start the game, or throw pepper while playing |
| P | Pause / resume |

- Each ingredient is **four segments**. Walk over all four and the ingredient
  drops one girder — segments reset when it lands, so you have to walk it again
  to move it further.
- A dropping ingredient **knocks the ingredient it lands on** down a level too,
  so a well-timed walk sets off a satisfying ripple down the stack.
- Ingredients dropped off the bottom girder land on the **plate**. Four
  ingredients on a plate serves a burger (**500** points); serving all four
  burgers clears the level (**1000** points) and refills your pepper.
- **Pepper** stuns everything in the cloud for four seconds — stunned enemies
  freeze and are safe to walk past. You start with **5** shakers.
- An ingredient that falls **through an enemy** squashes it for **100** points,
  doubling for each extra enemy caught by the same fall (up to 800).
- Touching an un-stunned enemy costs a chef; you start with **3** and the game
  ends when the last one is gone. Ingredient progress is kept between lives.
- Each level sends more enemies and moves them faster.
- Your best score is saved in the browser's `localStorage`.

## Development

Burger Time follows the repo-wide test setup. From the repository root:

```powershell
npm install
npx playwright install chromium
npx playwright test BurgerTime/tests/
```

See [DESIGN.md](DESIGN.md) for how the code is structured, how the drop rule
works, and how the simulation is made deterministic for testing.
