# Tower Stack

A one-button block-stacking arcade game built with HTML5 Canvas.

## How to Play

Open `index.html` in any modern browser — no build step, no dependencies.

| Input | Action |
|---|---|
| Space | Start, then drop the block |
| Click / tap the canvas | Start, then drop the block |
| Start button | Start / play again |

**Objective:** A block slides back and forth above the tower. Drop it as close
to perfectly aligned as you can. Any part that hangs over the block below is
sliced off, so sloppy drops make the tower narrower and narrower. Stack as high
as you can before a block misses the tower entirely.

**Perfect drops** (aligned within a few pixels) lose no width, regrow the block
a little, and score double — precision is how you survive a long run. The block
speeds up as your score climbs.

Your best score is saved in `localStorage` and persists between sessions.

See [DESIGN.md](DESIGN.md) for the mechanics, state model, and design notes.
