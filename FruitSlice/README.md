# Fruit Slice

A fast reflex arcade game in the spirit of the classic fruit-slicing games.
Fruit is launched up from the bottom of the screen in arcs — drag the mouse (or
a finger) to slice through it for points. Bombs are mixed in: slice one and it's
game over. Let three pieces of fruit fall past the bottom unsliced and you're
out.

## How to play

- **Drag** across the canvas to slice. Sweeping through several fruit in one
  stroke earns a **combo bonus**.
- **Avoid the bombs** (dark circles with a fuse) — slicing one ends the run
  instantly. Letting a bomb fall away is harmless.
- You have **3 lives**. Each fruit that drops off the bottom unsliced costs one.
- **Space / Enter** or the **Start** button begins the game.
- **P** pauses and resumes.

Your best score is saved in the browser (`localStorage`) between sessions.

## Playing

Open `index.html` directly in any modern browser — no build step or server
required.

## Development

Tests live in `tests/` and run with Playwright from the repository root:

```bash
npx playwright test FruitSlice/tests/
```

See [DESIGN.md](DESIGN.md) for how the projectile physics, segment-based
slicing, and lives work, plus the testability hooks the suite relies on.
