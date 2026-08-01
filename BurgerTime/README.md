# Burger Time

A single-screen platform arcade game, built with plain HTML5 canvas and
JavaScript — no build step, no dependencies. You are a chef on a lattice of
floors and ladders. Four burgers hang in pieces above the plates: walk the
whole length of a piece and it drops to the floor below. Drop every piece of
every burger onto its plate to clear the level, while hot dogs, eggs and
pickles chase you around the level.

Inspired by the 1982 Data East arcade classic.

![Burger Time screenshot](screenshot.png)

## How to play

Open `index.html` in any modern browser. Press **Space** (or click **Start
Game**) to begin.

| Key | Action |
|---|---|
| ← / A | Walk left |
| → / D | Walk right |
| ↑ / W | Climb up |
| ↓ / S | Climb down |
| Space | Start / restart, and spray pepper while playing |
| P | Pause / resume |

- Each ingredient is split into **four segments**. Step on all four and the
  piece drops to the surface below — worth **50 points**.
- A falling piece knocks loose any piece it lands on, so a well-timed drop can
  chain a whole stack down onto the plate at once.
- Any enemy caught under a falling piece is squashed for **100 points** and
  rides it down.
- **Pepper** stuns everything directly in front of you for a few seconds. You
  start with five shakers and earn one more per level — spend them when you're
  cornered on a ladder.
- Touching an enemy costs a chef. You have three; lose them all and the game
  ends. Burger progress survives a death.
- Building all four burgers clears the level: **500 bonus points**, an extra
  pepper, and faster, more numerous enemies next time around.
- Your best score is saved in the browser's `localStorage`.

## Development

Burger Time follows the repo-wide test setup. From the repository root:

```powershell
npm install
npx playwright install chromium
npx playwright test BurgerTime/tests/
```

See [DESIGN.md](DESIGN.md) for the level geometry, the movement and falling
rules, and how the simulation is made deterministic for testing.
