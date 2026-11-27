# Bezalel's Tiles — design

## Concept

A tangram-style shape-fitting puzzle. Seven wooden tiles — two large triangles,
one medium triangle, two small triangles, a square and a parallelogram — have to
be laid inside a shadowed figure so that they fill it exactly: no gaps, no
overlap, every tile used.

The theme is the craftsman's workshop of Exodus 31:3-5, where the Lord says of
Bezalel, *"I have filled him with the Spirit of God, with wisdom, with
understanding... to devise skilful works, to work in gold, and in silver, and in
brass, and in cutting of stones to set them, and in carving of timber."* The
eight figures are things from Scripture that a craftsman might cut from
timber: a cornerstone, the tent of meeting, Noah's ark, the house built on the
rock, a fish, a jewel from the high priest's breastplate, a fishing boat on
Galilee and the dove that came back with an olive leaf.

Nothing in the game is timed and nothing can be lost: a figure is either still
open or finished. This is a quiet puzzle, not an arcade game.

## The lattice — why the geometry is exact

Floating-point tangram games have to decide how close is "close enough", which
makes both the game and its tests fuzzy. This one is exact instead.

Every tile lives on an **integer lattice**. A tile's edges are either lattice
lines or 45-degree diagonals of a lattice cell, so a placed tile always covers a
whole number of **quarter cells**: each unit cell is cut by both of its diagonals
into four triangles, named `n`, `e`, `s` and `w`. A placement is therefore just a
set of keys like `"3,2,n"`.

- The seven tiles, in lattice units (one unit cell = 4 quarter triangles):

  | Tile | Shape | Area |
  |---|---|---|
  | 2 x large triangle | hypotenuse 4 along a lattice line, apex 2 deep | 16 triangles each |
  | 1 x medium triangle | legs 2 along lattice lines | 8 triangles |
  | 1 x square | a diamond, diagonals 2 x 2 | 8 triangles |
  | 1 x parallelogram | sides 2 and one cell diagonal | 8 triangles |
  | 2 x small triangle | hypotenuse 2 along a lattice line, apex 1 deep | 4 triangles each |

  Total: 64 quarter triangles = 16 unit cells, and every figure has exactly that
  area.

- Tiles turn in quarter turns and the parallelogram can also be flipped. A
  45-degree turn would put a tile's corners between lattice points, so it is not
  offered; see Assumptions.

- Whether a figure is finished is then a plain set comparison: the union of the
  seven tiles' triangles equals the figure's triangles. Because seven tiles
  always cover 64 triangles counted with repeats, any overlap makes the union
  smaller than 64, so set equality alone proves "no gaps and no overlap".

## Figures

Each figure is stored as an outline polygon on the lattice plus one known
solution (the seven placements). The outline gives the shadow that is drawn; the
stored solution powers the hint button and proves, in the test suite, that the
figure can really be built. The solutions were found with a backtracking exact
cover search over the quarter triangles.

The figures run roughly easiest to hardest: Cornerstone, Tent of Meeting, Noah's
Ark, House on the Rock, The Fish, Breastplate Jewel, Fishing Boat, The Dove.

## Mechanics

- The canvas has two areas: the **board** on top, where the shadow figure sits,
  and the **tray** below, holding the tiles that have not been laid yet.
- Dragging a tile onto the board snaps its bounding box to the nearest lattice
  point. Dropping it below the board, or outside the board, sends it back to its
  tray slot.
- Tiles may overlap while you work — the puzzle is only finished when the cover
  is exact — and overlapping tiles are drawn with a warning outline so a
  near-miss is visible.
- **Hint** lays one more tile from the stored solution and sends any tile that
  was in its way back to the tray. Hints are counted and shown, and a figure
  finished with hints says so.
- Finishing a figure shows an overlay with the figure's verse and a button for
  the next one. Finished figures are ticked in the figure list; the HUD counts
  them.

## Controls

| Input | Action |
|---|---|
| Drag a tile | Pick it up and lay it; it snaps to the lattice |
| Click a tile | Select it (keyboard then drives it) |
| `1`-`7` | Select a tile by number |
| Arrow keys | Move the selected tile one lattice unit (from the tray it jumps to the board first) |
| `R` / `Shift`+`R` | Turn the selected tile a quarter turn right / left |
| `F` | Flip the selected tile |
| `Backspace` / `Delete` | Send the selected tile back to the tray |
| `H` | Hint |
| `N` | Next figure |
| `Esc` | Reset the figure |

Buttons mirror Reset, Hint and Next figure, and a row of buttons jumps to any
figure.

## Code layout

- `index.html` — page, HUD, canvas, figure buttons, rules.
- `style.css` — workshop palette: aged timber, lamp light, cut-stone shadow.
- `game.js` — all logic, in plain script scope so the tests can call it:
  - *geometry*: `transformPoints`, `placedPolygon`, `trianglesOfPolygon`,
    `pieceTriangles` — the lattice maths above.
  - *state*: `FIGURES`, `PIECES`, `state` (tile placements, selection, hints,
    finished figures) and `loadFigure`, `resetFigure`, `placePiece`,
    `returnToTray`, `rotatePiece`, `flipPiece`, `hint`.
  - *checks*: `coveredTriangles`, `targetTriangles`, `isSolved`,
    `overlappingPieces`.
  - *input*: pointer handlers for drag and drop, key handlers.
  - *drawing*: `draw` renders board, shadow, tray and tiles each frame.

## Testing

`tests/bezalels-tiles.spec.js` drives the real page with Playwright. It covers
the lattice maths (tile areas, turning and flipping, each figure's stored
solution tiling its figure exactly), the interaction (dragging a tile from the
tray snaps it to the lattice, dropping it off the board returns it, keyboard
selection and movement, turning, flipping), and the game flow (hint, reset, next
figure, the finished overlay, the finished count). One figure is solved purely
by mouse drags, so the whole chain from pointer to win is exercised.

## Assumptions

These were decided while building, where the brief left room:

1. **Quarter turns only.** A real tangram lets a tile turn to any angle. Tiles
   here turn in quarter turns (and the parallelogram flips), because that is
   what keeps every corner on the lattice and the "is it finished" test exact.
   The eight figures were all designed and verified to be solvable under that
   restriction.
2. **Overlap is allowed while working.** Rather than refusing a drop that lands
   on another tile, the game lets tiles overlap and simply does not call the
   figure finished. Overlaps are outlined so the player can see them.
3. **No timer and no score.** The HUD counts figures finished and hints used.
   A tangram does not need a clock.
4. **Progress is kept for the session only.** Which figures are finished lives in
   memory; reloading the page starts the set fresh. No local storage, in keeping
   with the other games in this repo.
5. **One stored solution per figure.** Several figures have more than one
   solution; the player may finish a figure a different way and it still counts.
   The stored solution is only used by the hint button and by the tests.
6. **Mouse and keyboard.** Touch is not handled here; a separate pull request in
   this repository is adding touch controls across all games.
