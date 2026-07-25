# Klotski

The classic **Huarong Pass** (华容道) sliding-block puzzle — sold in the West as
**Klotski** — rendered on an HTML5 canvas. Ten wooden blocks are packed into a
4×5 tray with only two empty cells. The big **2×2 block** (marked ★) starts
trapped up top; slide the other blocks out of its way and work it down to the
exit gap at the bottom of the tray. Solve it in as few moves as you can.

## How to play

Open `index.html` in any browser — no build step or server required.

1. Press **Start Puzzle** (or any key) to begin.
2. **Click a block** to pick it up — a bright ring shows what's selected.
3. Slide it with the **arrow keys**, or **click an empty cell** next to it to
   move it there. A block can only slide into empty space, one cell at a time.
4. **Win** by sliding the ★ 2×2 block down until it fills the bottom-centre
   exit gap.

The move counter ticks up with every slide; your fewest-moves solve is saved in
the browser and shown as **Best**.

## Layout

The shipped puzzle is the famous **"Across the Board" (横刀立马)** opening:

```
[ ][★★][ ]
[ ][★★][ ]
[ ][==][ ]
[ ][][][ ]
[]  ..  []
```

one 2×2 block, four vertical 1×2 blocks, one horizontal 2×1 block, four 1×1
soldiers, and two empty cells. It is solvable (optimal is 81 slides).

## Development

Tests are written with Playwright and live in `tests/`. From the repo root:

```powershell
npx playwright test Klotski/tests/
```

See [DESIGN.md](DESIGN.md) for how the code is structured.
