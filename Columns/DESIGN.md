# Columns — Design Notes

## Concept

Columns is a falling-jewel puzzle on an HTML5 canvas, inspired by the 1990 Sega
classic. Jewels fall from the top in vertical groups of three. You slide the
group left and right and **cycle** the order of its three colours, then let it
land. Whenever three or more jewels of the same colour line up — horizontally,
vertically, **or diagonally** — they vanish, everything above collapses down to
fill the gap, and any new lines that form clear too, chaining for bonus points.
The board slowly fills; clear jewels to keep it from stacking to the top. When a
fresh group can no longer enter, the game is over.

Unlike the swap-based matchers elsewhere in this repo, Columns is a
**falling-piece stacker**: you never swap two jewels on a full board — you place
a descending triple and the whole board reacts.

## Mechanics

### The board

- A grid `COLS` (6) wide by `ROWS` (14) tall. Each cell is empty (`null`) or
  holds a colour index `0…NUM_COLORS-1`.

### The falling group

- A group is a single column of three jewels, each an independent colour drawn
  from `NUM_COLORS` (6) colours. It enters at the top of the centre column.
- **Move** — shift the whole group one cell left/right if the destination cells
  are on the board and empty.
- **Cycle** — rotate the three colours within the group: the bottom jewel wraps
  to the top (`[a,b,c] → [c,a,b]`). This is the only "rotation"; the group never
  changes shape.
- **Soft drop** — nudge the group down one cell on demand.
- **Gravity** — on a fixed interval the group falls one cell on its own. When it
  cannot fall further (floor or a filled cell beneath it) it **locks** into the
  board.

### Matching & cascades

After a group locks, the board is resolved:

1. **Find matches** — scan every row, column, and both diagonals for runs of
   three or more identical colours. Every jewel in such a run is marked.
2. **Clear** — marked jewels are removed and the score increases.
3. **Collapse** — in each column the surviving jewels fall to the bottom,
   closing gaps.
4. **Repeat** — steps 1–3 run again on the settled board. Each repeat is one
   link of a **cascade chain**, and later links in a chain are worth more.

### Scoring & levels

- Each cleared jewel scores `10 × chainLink` points, so a jewel cleared by the
  second cascade link is worth double a first-link clear.
- Every cleared jewel counts toward a running total; the **level** rises one per
  `JEWELS_PER_LEVEL` (30) jewels cleared, and each level shortens the gravity
  interval, so groups fall faster.

### Game over

When a new group is spawned but its cells at the top of the centre column are
already occupied, it cannot enter and the game ends.

## Controls

| Action | Keys |
|---|---|
| Move left / right | **←** / **→** or **A** / **D** |
| Cycle the group's colours | **↑** or **W** |
| Soft drop | **↓** or **S** |
| Start | **Space**, an arrow key, or the **Start** button |
| Pause / resume | **P** |

## State model

`state` is one of `idle`, `running`, `paused`, `over`. The main loop only runs
gravity while `running`. The simulation is exposed as small, individually
callable functions — `spawnPiece`, `movePiece`, `cyclePiece`, `softDrop`,
`gravityDrop`, `lockPiece`, `findMatches`, `resolveBoard` — so the Playwright
tests can build exact board states and resolve them deterministically, the same
testing seam the other games here use.

## Assumptions

- **Board is 6×14, canvas 240×560.** Six columns is the classic Columns width;
  fourteen rows give room to stack. Cell size is 40 px, so the canvas is exactly
  the grid. The dimensions are asserted in the tests, making them a contract.
- **Matches include diagonals.** This is faithful to the original Columns and is
  the whole point of the game; horizontal/vertical only would make it a
  different, duller puzzle.
- **Cycle wraps bottom-to-top in one direction only.** The original lets you
  cycle both ways, but a single direction reaches every arrangement of three in
  at most two presses and keeps the input model minimal. Noted as a deliberate
  simplification.
- **Colour generation is random, seeded from the clock at each start.** Tests
  never depend on a specific sequence — they set `board` and `piece` directly —
  so an unseeded, varied game and deterministic tests coexist (the same approach
  Doodle Jump uses in this repo).
- **Gravity is discrete, one cell per tick.** No sub-cell interpolation; the
  board is a pure grid. This keeps every rule a simple integer operation and
  every test exact.
- **No hard drop, no hold, no next-piece preview.** Kept out of scope to keep
  the mechanic a single well-tested rule set; difficulty comes from the rising
  gravity speed alone.
