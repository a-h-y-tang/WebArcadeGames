# ColorFlow

Connect every pair of coloured dots with a pipe — and fill the whole board
while you're at it. A "flow" puzzle rendered on an HTML5 canvas, in the spirit
of *Flow Free*.

## How to play

1. Open `index.html` in a browser (no server or build step needed).
2. Press **Start Game** to load the first puzzle.
3. **Drag** from a coloured dot to draw a pipe toward its matching dot.
4. Pipes can't cross. Drawing over another pipe cuts it — and dragging back
   along your own pipe erases it, so you can rework a route freely.
5. You clear a level only when **every pair is connected _and_ every cell is
   filled**. Connecting the pairs is easy; covering the whole board is the game.
6. Clear a level to advance; clear the final level to win the set.

### Controls

| Input                 | Action                              |
|-----------------------|-------------------------------------|
| Mouse / touch drag    | Draw a pipe from a dot or pipe      |
| Release               | Finish the pipe                     |
| **R**                 | Reset the current level             |
| **N**                 | Next level                          |

The **Reset** and **Next** buttons do the same as the keys.

## HUD

- **Level** — current puzzle number.
- **Pipes** — connected colours out of the total.
- **Flow** — percentage of the board filled (100% is required to win).

See [DESIGN.md](DESIGN.md) for how the code works.
