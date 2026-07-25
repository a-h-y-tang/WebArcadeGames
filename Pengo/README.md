# Pengo

A canvas re-creation of Sega's 1982 maze-action arcade classic. You are a penguin
trapped in a field of ice blocks, hunted by wandering **Sno-Bees**. Your only
weapon is the ice itself: **push a block and it slides across the field until it
hits something** — and any Sno-Bee caught in its path is flattened. Crush every
Sno-Bee to clear the level.

## How to play

Open `index.html` in any browser — no build step or server required.

| Action | Input |
|---|---|
| Move / push | Arrow keys or `W` `A` `S` `D` |
| Pause / resume | `P` |
| Restart | `R` |
| Start | any arrow / WASD, or the **Start** button |

## Rules

- **Push a block** by walking into it. It slides in that direction across empty ice
  until it meets another block or the wall.
- A **sliding block crushes** every Sno-Bee in its path (100 points each) and keeps
  going.
- Push an **ice block** with no room to slide and it **breaks** (10 points). A
  **diamond block** never breaks — it only slides.
- Line up the **three diamond blocks** in a row or column for a **500-point bonus**.
- Touch a Sno-Bee — or let one walk into you — and you lose one of your **3 lives**.
  Losing a life respawns you and the Sno-Bees; the ice field stays as it was.
- Crush every Sno-Bee to advance to the next level: a fresh field with one more,
  faster Sno-Bee.
- Your best score is saved to `localStorage`.

## Files

- `index.html` — page layout and HUD.
- `style.css` — presentation.
- `game.js` — all game logic (field, pushing/sliding, crushing, enemy AI, rendering).
- `DESIGN.md` — design notes, mechanics, and the testable architecture.
- `tests/pengo.spec.js` — Playwright test suite.

See `DESIGN.md` for how the code is structured and why it's easy to test.
