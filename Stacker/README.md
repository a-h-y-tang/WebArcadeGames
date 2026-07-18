# Stacker

The classic arcade tower-builder, on an HTML5 canvas. A block slides back and
forth at the top of your tower — tap to drop it. Whatever hangs over the block
below gets sliced off, so the tower narrows with every imperfect drop. Miss the
stack completely and the run is over. How high can you build?

## How to play

- A block slides left and right at the top of the tower.
- **Drop** it with **Space**, **↓**, **Enter**, or by **clicking** the canvas.
- The part of the block that overhangs the one below is trimmed away — so line
  it up! A near-perfect drop keeps its width (and regrows a little), letting you
  recover from earlier trims.
- Drop with **no overlap at all** and it's game over.
- Each block you place slides a little faster than the last.
- Your score is the number of blocks stacked. Your **Best** is saved between
  sessions.

### Controls

| Key | Action |
|---|---|
| Space / ↓ / Enter / click | Drop the block (and start / restart) |
| P | Pause / resume |

Or click **Start Game** / **Play Again**.

## Running it

Open `index.html` directly in any modern browser — no build step or server
needed.

## Tests

Playwright tests live in `tests/`. From the repo root:

```powershell
npx playwright test Stacker/tests/
```

See [design.md](design.md) for the design, mechanics, and how the code is
structured for deterministic testing.
