# Klotski — Design

## Concept

Klotski (the classic Chinese **Huarong Pass** / *Huáróngdào* sliding-block
puzzle, also sold in the West as "Klotski") is a single-player logic puzzle.
Ten wooden blocks of four shapes are packed into a 4×5 tray with just two empty
cells. The largest block — a 2×2 square (traditionally the general **Cao Cao**)
— starts trapped near the top. The player slides blocks around, one cell at a
time, until the 2×2 block reaches the exit gap at the **bottom-centre** of the
tray and can slip out. The goal is to solve it in as few moves as possible
(the standard "横刀立马 / Across the Board" layout has an 81-move optimal
solution).

## Board & pieces

The tray is **4 columns wide × 5 rows tall** (20 cells). The canvas is
`400 × 500` px, so each cell is `100 × 100` px.

The starting layout ("Across the Board", the most famous opening):

```
 col:  0     1     2     3
 row0 [ g1 ][ cao ][ cao ][ g2 ]
 row1 [ g1 ][ cao ][ cao ][ g2 ]
 row2 [ g3 ][ guan][ guan][ g4 ]
 row3 [ g3 ][ s1  ][ s2  ][ g4 ]
 row4 [ s3 ][  ·  ][  ·  ][ s4 ]
```

| id            | shape       | w×h | role                                   |
|---------------|-------------|-----|----------------------------------------|
| `cao`         | big square  | 2×2 | the goal piece                         |
| `g1`–`g4`     | vertical    | 1×2 | four "generals" down the sides         |
| `guan`        | horizontal  | 2×1 | one wide block                         |
| `s1`–`s4`     | small       | 1×1 | four single soldiers                   |

That is `4 + 4×2 + 2 + 4 = 18` occupied cells, leaving exactly **2 empty
cells** (at `(4,1)` and `(4,2)` to start).

## Mechanics

- A block may slide **one cell** at a time up, down, left, or right.
- A slide is legal only if **every** cell the block would move into is inside
  the tray and currently empty (or already part of that same block).
- The puzzle is **solved** when the 2×2 `cao` block's top-left corner reaches
  `(row 3, col 1)`, i.e. it occupies the bottom-centre 2×2 region and lines up
  with the exit gap.
- The move counter increases by one for every legal single-cell slide.
- The fewest-moves record is stored in `localStorage` (`klotski-best`).

## Controls

- **Click a block** to select it (a highlight ring appears).
- **Arrow keys** slide the selected block one cell in that direction.
- **Click an empty cell** adjacent to the selected block to slide it there.
- **Start / Reset** button (or any key from the start/win overlay) begins or
  restarts the puzzle.

## Rendering

Blocks are drawn on a `<canvas>` with rounded rectangles and a soft
gradient/shadow, each shape given its own colour family; the selected block
gets a bright outline. The exit gap at the bottom is marked so the objective is
obvious. A small HUD shows the current move count and the best (fewest) solve.

## Assumptions

- **"Simpler interpretation" of a move:** each single-cell slide counts as one
  move. (Some physical Klotski scorers count a run of consecutive same-direction
  slides of one block as a single move; we take the simpler per-cell count and
  document it here.)
- Only the single canonical "Across the Board" starting layout is shipped —
  no random layout generator — to keep the puzzle deterministic and always
  solvable.
- The `cao` block only ever needs to reach the bottom-centre; there is no
  animated "slide out of the tray" step — reaching `(3,1)` is the win.
- Best score tracks the **minimum** moves across solves in this browser; an
  empty record is shown as `–`.
- No move-undo or auto-solver is provided (kept intentionally minimal).
