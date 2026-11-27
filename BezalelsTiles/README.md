# Bezalel's Tiles

A tangram-style shape-fitting puzzle. Seven wooden tiles lie on the craftsman's
bench: two large triangles, a medium triangle, two small triangles, a square and
a parallelogram. Lay all seven inside the shadowed figure so that they cover it
exactly — no gaps, no overlaps, every tile used.

> "I have filled him with the Spirit of God, in wisdom, and in understanding,
> and in knowledge, and in all manner of workmanship." — Exodus 31:3

Bezalel was the craftsman God filled with his Spirit to cut stone and carve
timber for the tabernacle. The eight figures are things a craftsman might cut
from a plank: a cornerstone, the tent of meeting, Noah's ark, the house built on
the rock, a fish, a jewel from the high priest's breastplate, a fishing boat on
Galilee, and the dove that came back with an olive leaf.

## Playing

Open `index.html` in any browser. There is no build step and no server.

## How to play

- Drag a tile from the bench into the shadow. It snaps to the grid.
- Turn a tile with **R**, turn it back with **Shift**+**R**, flip it with **F**.
- Drop a tile below the figure, or press **Backspace**, to put it back on the
  bench.
- The figure is finished the moment the seven tiles cover the shadow exactly.
  Tiles that lie across each other are outlined in red, so a near-miss is easy
  to spot.
- Stuck? **Hint** lays one more tile in its proper place and clears anything
  that was in the way. Hints are counted, and a figure finished with hints says
  so, but it still counts as finished.

## Controls

| Input | Action |
|---|---|
| Drag a tile | Pick it up and lay it; it snaps to the grid |
| Click a tile | Select it |
| `1`–`7` | Select a tile by its number on the bench |
| Arrow keys | Move the selected tile one step (from the bench it jumps onto the board first) |
| `R` / `Shift`+`R` | Turn the selected tile a quarter turn right / left |
| `F` | Flip the selected tile |
| `Backspace` / `Delete` | Put the selected tile back on the bench |
| `H` | Hint |
| `N` | Next figure |
| `Esc` | Reset the figure |

The buttons under the board do the same: any of the eight figures can be picked
at any time, and finished figures are ticked.

## The figures

| Figure | Verse |
|---|---|
| The Cornerstone | Psalm 118:22 |
| The Tent of Meeting | Exodus 33:7 |
| Noah's Ark | Genesis 6:14 |
| The House on the Rock | Matthew 7:24 |
| The Fish | Matthew 4:19 |
| The Breastplate Jewel | Exodus 28:17 |
| The Fishing Boat | Luke 5:3 |
| The Dove | Genesis 8:11 |

## How the code works

See [DESIGN.md](DESIGN.md). In short: every tile sits on an integer lattice and
covers a whole number of quarter cells, so "the tiles cover the figure exactly"
is an exact set comparison rather than a measurement with a tolerance.

## Tests

```powershell
npx playwright test BezalelsTiles/tests/
```

The suite drives the real page: the lattice maths, dragging tiles with the
mouse, the keyboard controls, hints, reset, the figure list, and one figure
solved from start to finish with mouse and keyboard alone.
