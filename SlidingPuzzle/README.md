# Sliding Puzzle

The classic 15-puzzle, built with HTML5 Canvas — slide the numbered tiles back
into order.

## How to Play

Open `index.html` in any modern browser — no build step, no dependencies.

| Input | Action |
|---|---|
| Click a tile | Slide it (and any tiles between it and the gap) toward the empty space |
| Arrow keys / WASD | Slide the neighbouring tile into the gap |
| N | Start a new scrambled puzzle |

**Objective:** Arrange the tiles so they read `1`–`15` left-to-right,
top-to-bottom, with the empty space in the bottom-right corner. Tiles snap to
green once they're sitting in their final home position, so you can see your
progress at a glance.

A tile can only move when it shares a row or column with the empty space. Try
to solve the puzzle in as few moves as possible — your best solve is saved in
`localStorage` and shown as **Best**.

Every scramble is guaranteed to be **solvable** (the board is shuffled by making
random legal slides from the solved state, never by randomly permuting tiles).

## Files

| File | Purpose |
|---|---|
| `index.html` | Page scaffolding, HUD, and win overlay |
| `style.css` | Presentation |
| `game.js` | All game logic and canvas rendering |
| `DESIGN.md` | How the code works |
| `tests/` | Playwright test suite |
