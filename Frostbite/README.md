# Frostbite

A canvas homage to the Activision classic. You're Frostbite Bailey, hopping
across four rows of drifting ice floes to harvest ice blocks and build an igloo
— before the cold gets you.

## How to play

- **← / →** (or **A / D**) slide Bailey along his current row.
- **↑ / ↓** (or **W / S**) hop him up or down a row.
- Hop onto a row of **white** floes to harvest an ice block — the row turns
  **blue** and your igloo grows (score +10). A blue row gives nothing; once all
  four rows are blue they refresh back to white.
- **Miss a floe** — hop onto open water — and you fall in and lose a life.
- The **temperature** bar (top-left) steadily drops. If it empties, Bailey
  freezes and loses a life.
- Fill the igloo (**15 blocks**), then hop up onto the **top shore** to step
  inside and advance to the next, colder, faster level — banking your leftover
  warmth as bonus points.
- You start with **3 lives**. Lose them all and it's game over.
- **P** pauses and resumes.

Your best score is saved in the browser via `localStorage`.

## Running

Open `index.html` directly in any modern browser — no build step or server
needed.

## Tests

Playwright tests live in `tests/frostbite.spec.js`. From the repo root:

```bash
npx playwright test Frostbite/tests/
```

## Design

See [design.md](design.md) for the layout, mechanics, physics model, and the
assumptions made while building it.
