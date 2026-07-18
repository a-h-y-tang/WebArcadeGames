# Flood It

A single-player colour-flood puzzle. Recolour the flood region — which starts
at the **top-left corner** — until the entire board is one colour, and try to
do it in as few moves as possible.

## How to play

1. Press **Start Game** (or any colour key) to begin.
2. The top-left tile and every same-coloured tile connected to it form the
   **flood region** (its origin is outlined in white).
3. Choose a colour. The whole region changes to that colour and swallows any
   neighbouring tiles that already had it, so the region grows.
4. Unify the **entire 14 × 14 board** into one colour before your **30 moves**
   run out.

Re-picking the colour the region already is does nothing and costs no move.

## Controls

| Action | Input |
|---|---|
| Choose colour 1–6 | Click a swatch, or press `1`–`6` |
| New game | `R` (or `N`), or the button in the overlay |

## Scoring

Your **Best** is the fewest moves you've ever used to win (lower is better),
saved in the browser via `localStorage`.

## Running the tests

From the repository root:

```powershell
npx playwright test FloodIt/tests/
```

## Files

- `index.html` — page structure, HUD, canvas, colour palette.
- `style.css` — dark arcade theme shared in spirit with the other games.
- `game.js` — board generation (seedable PRNG), flood logic, input, rendering.
- `DESIGN.md` — deeper design notes, mechanics, and assumptions.
