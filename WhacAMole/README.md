# Whac-A-Mole

The classic timed reflex arcade game, built with HTML5 Canvas.

## How to Play

Open `index.html` in any modern browser — no build step, no dependencies.

| Input | Action |
|---|---|
| Click / tap a mole | Whack it |
| Space / Enter / click | Start / restart |
| P | Pause / resume |

**Objective:** Moles pop up from a 3×3 grid of holes. Click them before they
duck back down — each hit is worth a point. You have **30 seconds**; rack up as
many whacks as you can before time runs out.

**Difficulty:** The moles appear faster and stay up for less time as the clock
winds down, so the final seconds are a frenzy.

Your best score is saved in `localStorage` and persists between sessions.

## Design

See [DESIGN.md](DESIGN.md) for the concept, mechanics, state model, and the
assumptions made while building it.

## Tests

Playwright tests live in [`tests/`](tests/) and cover initial state, starting,
whacking (including canvas clicks), the countdown timer, pausing, and game
over. Run them from the repo root:

```powershell
npx playwright test WhacAMole/tests/
```
