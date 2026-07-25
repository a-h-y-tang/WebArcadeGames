# Flow

A grid logic puzzle. Every level has pairs of coloured dots. Connect each pair
with a **pipe** so that **no pipes cross** and **every cell is filled**. Solve
all three levels.

## How to play

- **Press and drag** from a coloured dot through adjacent cells to its matching
  dot to lay a pipe.
- **Drag back** onto a pipe's previous cell to retract it.
- Dragging one pipe across another **cuts** the older pipe at the crossing — but
  you can never route through another colour's dot.
- Fill the whole board with pipes and connect every pair to solve the level.

| Input | Action |
|---|---|
| Mouse drag | Draw / re-route a pipe |
| R | Reset the current level |
| N / Enter | Next level (once solved) |

Your fewest-moves best for each level is saved in `localStorage`. Open
`index.html` in a browser — no build step or server required.

See [DESIGN.md](DESIGN.md) for the mechanics, data structures, and design
decisions (including why the levels are hand-authored rather than generated).
