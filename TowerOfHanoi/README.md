# Tower of Hanoi

The classic **Tower of Hanoi** puzzle on an HTML5 canvas. Move the whole stack
of disks from peg **A** to peg **C**, one disk at a time, never placing a larger
disk on a smaller one. Solving *n* disks always takes at least **2ⁿ − 1** moves,
and the game shows that target so you can chase a perfect game.

## How to play

Open `index.html` in any browser — no build step or server required.

| Action                       | Input                                          |
|------------------------------|------------------------------------------------|
| Lift a peg's top disk        | Click the peg                                  |
| Drop the held disk on a peg  | Click the destination peg                      |
| Cancel a selection           | Click the same peg again                       |
| Choose the number of disks   | The **3 / 4 / 5 / 6** buttons                  |
| Auto-solve (demo)            | The **Solve** button                           |
| Restart the current puzzle   | `R`, or the **Reset** button                   |

When you lift a disk, the pegs it can legally move to are outlined in green.

## Rules

- Three pegs (A, B, C) and *n* disks of distinct sizes.
- Disks start on peg **A**, largest on the bottom, smallest on top.
- Each move takes the **top** disk of one peg to another peg.
- A disk may only go onto an **empty peg** or a **larger** disk.
- You **win** when every disk is stacked on peg **C**.
- Your move count is shown against the optimal **2ⁿ − 1**; matching it is a
  perfect solve. The fewest moves you've achieved for each disk count is saved as
  your **Best** in `localStorage`.

## The Solve button

Watch the puzzle solve itself: **Solve** restarts the current puzzle and plays
back the canonical recursive solution — always the optimal number of moves.

## Files

- `index.html` — page layout and HUD.
- `style.css` — presentation.
- `game.js` — all game logic (state, rules, solver, rendering).
- `DESIGN.md` — design notes, rules detail, and the testable architecture.
- `tests/tower-of-hanoi.spec.js` — Playwright test suite.

See `DESIGN.md` for how the code is structured and why it's easy to test.
