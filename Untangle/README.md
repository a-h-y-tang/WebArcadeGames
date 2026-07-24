# Untangle

A single-player **planarity** puzzle. The board opens as a tangle of nodes and
straight-line edges, with lines crossing all over. Drag the nodes around until
**no two edges cross** — every puzzle is guaranteed to have a crossing-free
solution, so it can always be solved.

![Untangle screenshot](screenshot.png)

## How to play

1. Press **Start** (or pick a difficulty) to reveal a tangle.
2. **Drag any node** to move it. Edges that still cross something are drawn in
   **red**; edges that are already clear are muted blue.
3. Keep untangling until the **Crossings** counter reaches **0** — that wins the
   puzzle.
4. Try to do it in as few **moves** (drags) as possible.

## Difficulty

| Level | Nodes | Edges |
|---|---|---|
| Easy | 6 | 9 |
| Medium | 9 | 15 |
| Hard | 12 | 21 |

(Each puzzle is a triangulation, so it has `2n − 3` edges.)

## Controls

| Action | Input |
|---|---|
| Move a node | Click / touch and drag it |
| Set difficulty | `Easy` / `Medium` / `Hard` buttons, or press `1` / `2` / `3` |
| New puzzle | `New Puzzle` button, or press `N` (or `R`) |

## Scoring

Your **Best** is the fewest moves you've ever used to solve a puzzle at the
current difficulty (lower is better), saved per difficulty in the browser via
`localStorage`.

## Running the tests

From the repository root:

```powershell
npx playwright test Untangle/tests/
```

## Files

- `index.html` — page structure, HUD, canvas, difficulty controls.
- `style.css` — dark arcade theme shared in spirit with the other games.
- `game.js` — puzzle generation (seedable PRNG + convex triangulation),
  segment-crossing geometry, drag input, and rendering.
- `DESIGN.md` — deeper design notes, the solvability guarantee, and assumptions.
