# Lunar Lander

A physics recreation of the 1979 Atari arcade classic, built on an HTML5 canvas
with no dependencies. Ride gravity down and feather the thruster to set your
module gently onto the landing pad.

## How to play

Open `index.html` in any modern browser — no build step or server required.

### Controls

| Input | Action |
|---|---|
| ↑ / W / Space | Fire the main thruster |
| ← / → or A / D | Rotate left / right |
| P | Pause / resume |
| ↑ / Space / arrow | Start / restart |

### Goal

- Gravity constantly pulls the lander down. Thrust — stronger than gravity —
  slows the fall, but every burn drains the **fuel** gauge. At empty, the engine
  dies.
- Because thrust follows the lander's nose, **rotate** to cancel any sideways
  drift, then straighten up before you touch down.
- Land on the flat green **pad** to succeed. A touchdown counts only if you are:
  - **over the pad**,
  - descending **slower** than the safe vertical and horizontal speed limits, and
  - **within ~14° of upright**.
- A clean landing banks a bonus — bigger for a softer touchdown with more fuel to
  spare — and advances you to the next **level**, where the pad is narrower and
  gravity a little stronger.

### Lives

You start with **3** landers. A crash (too fast, too steep, or off the pad)
costs one and re-drops a fresh lander to retry the level. Run out and it's game
over. Your best score is saved in the browser's `localStorage` and shown as
**Best**.

## How it works

See [DESIGN.md](DESIGN.md) for the concept, mechanics and code structure. In
short, all motion is measured in pixels-per-millisecond and advanced by a pure
`step(dt)` function, which keeps the simulation frame-rate independent and makes
the whole game deterministically testable.

## Tests

Playwright tests live in `tests/` and are run from the repo root:

```powershell
npx playwright test LunarLander/tests/
```
