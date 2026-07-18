# Minesweeper

The classic logic puzzle, built with HTML5 Canvas.

## How to Play

Open `index.html` in any modern browser — no build step, no dependencies.

A 9 × 9 grid hides **10 mines**. Reveal a cell to see how many of its eight
neighbours are mined; use those numbers to deduce where the mines are. Reveal
every safe cell to win — reveal a mine and it's game over.

| Input | Action |
|---|---|
| Left-click | Reveal a cell |
| Right-click | Flag / unflag a suspected mine |
| Any key | Start or restart |

**First click is always safe** — mines are laid *after* your opening move, so
your first reveal never loses and usually opens up a whole region.

**Numbers** count adjacent mines (1–8). A blank (zero) cell automatically opens
its neighbours, cascading across empty areas.

**Mine counter** shows mines remaining (total minus the flags you've placed).

**Timer** starts on your first reveal. Your fastest winning time is saved in
`localStorage` and shown as **Best**; it persists between sessions.

See [design.md](design.md) for how the code is structured.
