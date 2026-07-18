# Whack-a-Mole

The classic fairground reflex game on an HTML5 canvas. Moles pop out of a 3×3
grid of holes — bop each one before it ducks back down and rack up the highest
score before the 30-second clock runs out.

## How to play

Open `index.html` in any modern browser — no build step or server required.

Press **Space** to start.

| Input | Action |
|---|---|
| Mouse click | Whack the mole in the clicked hole |
| Keys 1–9 | Whack the corresponding hole (top-left = 1, bottom-right = 9) |
| Space | Start / restart |
| P | Pause / resume |

## Rules

- Each mole you bop scores **10** points.
- A mole that ducks back down before you hit it is a **miss**.
- The game speeds up: every 10 seconds the level rises, moles appear more
  often and stay up for less time.
- You have **30 seconds** per round. When the clock hits zero, it's game over.
- Your best score is saved in the browser (`localStorage`).

## Under the hood

See [DESIGN.md](DESIGN.md) for the architecture, the simulation model, and the
assumptions made. The game is covered by a Playwright test suite in
[`tests/`](tests/); run it from the repo root with `npm test`.
