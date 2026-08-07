# Marble Spiral

A marble-shooter built with plain HTML5 canvas and JavaScript — no build step, no
dependencies. A chain of coloured marbles crawls along a spiral groove towards
the pit at its centre. You control the turret in the middle: aim with the mouse,
fire marbles into the chain, and pop them by lining up three or more of a colour.
Clear the whole chain before the leading marble drops into the pit.

Inspired by *Puzz Loop* and *Zuma*.

![Marble Spiral screenshot](screenshot.png)

## How to play

Open `index.html` in any modern browser. Press **Space** (or click **Start
Game**) to begin.

| Input | Action |
|---|---|
| Mouse move | Aim the turret |
| Click | Fire the loaded marble |
| Space | Start the game; while playing, swap the loaded and next marbles |
| Enter | Same as Space |
| P | Pause / resume |

- A fired marble slots into the chain wherever it lands. **Three or more** of the
  same colour touching each other pop.
- A pop that leaves two matching groups next to each other **chain-reacts** — each
  pop in the cascade is worth more than the last (10 points per marble × the
  cascade step).
- Every pop also shoves the chain **back** from the pit, which is the only way to
  buy yourself time.
- Clear every marble in the level for a **250 point bonus**. The next level sends
  a longer, faster chain with more colours in play (up to six).
- The turret nearly always loads a colour that is still on the board, so you are
  rarely stuck with a useless marble — and you can hold one in reserve by
  swapping with **Space**.
- If the leading marble reaches the pit, the run is over. Your best score is
  saved in the browser.

## Files

| File | Purpose |
|---|---|
| `index.html` | HUD, canvas and overlay markup |
| `style.css` | Dark arcade styling shared with the rest of the repo |
| `game.js` | Path table, chain model, simulation, rendering and input |
| `DESIGN.md` | How the code works, and the assumptions behind it |
| `tests/marblespiral.spec.js` | 62 Playwright specs |

## Tests

From the repo root:

```powershell
npx playwright test MarbleSpiral/tests/
```
