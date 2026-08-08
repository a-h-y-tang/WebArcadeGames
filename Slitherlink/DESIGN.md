# Slitherlink — Design

## Game concept

Slitherlink (also known as *Loop the Loop* or *Fences*) is a pencil-and-paper
logic puzzle played on a lattice of dots. The player draws a **single closed
loop** along the lattice edges. Numbers printed inside the cells say exactly how
many of that cell's four sides the loop uses. Cells without a number are
unconstrained.

A board is solved when both conditions hold at once:

1. **Every clue is exact** — a `2` has exactly two of its sides drawn, a `0` has
   none, and so on.
2. **The drawn segments form one closed loop** — every dot touches either zero
   or exactly two segments, and all segments belong to a single connected
   component. Two separate loops, a dead-end path, or a dot with three
   segments all fail.

## Mechanics

### Board model

Dots sit on an `(rows + 1) x (cols + 1)` lattice. Each edge between adjacent
dots has one of three states:

| State | Value | Meaning |
|---|---|---|
| empty | `0` | undecided |
| line | `1` | part of the loop |
| cross | `2` | the player's "this is definitely not part of the loop" mark |

Edges are addressed by string keys:

- `H:r:c` — horizontal, `dot(r, c) → dot(r, c+1)`; equivalently the **top** side of cell `(r, c)`
- `V:r:c` — vertical, `dot(r, c) → dot(r+1, c)`; equivalently the **left** side of cell `(r, c)`

So the four sides of cell `(r, c)` are `H:r:c`, `H:r+1:c`, `V:r:c`, `V:r:c+1` —
which is what `linesAroundCell()` counts, ignoring crosses.

### Loop validation

`isSingleLoop()` builds an adjacency map over dots using only `line` edges and
then checks three things: at least one line exists, every dot in the map has
degree exactly 2, and a flood fill from any dot reaches every other dot in the
map. Degree-2-everywhere plus connectedness is exactly "one simple closed
curve", so no separate topology check is needed.

`isSolved()` is `allCluesSatisfied() && isSingleLoop()`. Crosses are purely a
player annotation and are ignored by both.

### Puzzle generation (offline)

The five bundled puzzles were produced by an offline generator rather than
being hand-authored, using the cell-colouring view of Slitherlink:

- Colour each cell *inside* or *outside* the loop (the region beyond the grid is
  outside). An edge is a loop segment exactly when the two cells it separates
  differ in colour.
- Grow a random connected blob of *inside* cells, keeping only blobs whose
  boundary passes the same `isSingleLoop()` test used at runtime. That
  guarantees the stored `solution` really is one closed loop.
- Derive the full clue grid from the blob, then blank clues one at a time in
  random order, keeping a blank only while an exhaustive depth-first solver
  (row-major cell colouring, with clue-bound pruning) still finds **exactly
  one** solution.

Each level therefore ships with a clue grid that has a *unique* solution, plus
the `solution` edge list, which the test suite replays to verify the puzzle.

### Difficulty ramp

Levels grow 4x4 → 5x5 → 6x6 → 7x7 → 8x8, with the fraction of given clues
falling as the grid grows.

### Rendering

A single 560x560 canvas. Cell size is `min(108, (560 - 88) / max(rows, cols))`
and the grid is centred, so small boards stay chunky and large ones still fit.
Clue numbers are tinted by status — white when unsatisfied, green when exact,
red when over-drawn — which gives continuous feedback without spoiling
anything. The edge under the cursor gets a translucent preview stripe. On a
win, the loop turns green and the enclosed cells are tinted; the interior is
found by ray casting each row and counting vertical lines crossed (odd = inside).

### HUD and scoring

Level name, unsatisfied clue count, move count, and best-ever move count for
that level (`localStorage`, key `slitherlink-best-<index>`). One edge state
change is one move, so a lower score means a more decisive solve; the best is
only overwritten when beaten.

## Controls

| Input | Action |
|---|---|
| Left-click an edge | Cycle empty → line → cross → empty |
| Right-click an edge | Cycle empty → cross → line → empty |
| Tap (touch) | Same as left-click |
| **R** | Restart the current level |
| **N** | Next level (wraps) |
| **Space** | Start / continue |
| Level buttons | Jump straight to a level |

Clicks map to edges by nearest point-to-segment distance, accepted within
`0.42 * cell`, so there is a comfortable hit target around each edge without
neighbouring edges overlapping.

## Code layout

| File | Contents |
|---|---|
| `index.html` | HUD, level buttons, canvas, overlay, control hints |
| `style.css` | Dark slate theme with an amber loop accent |
| `game.js` | Level data, board state, rules, rendering, input |
| `tests/slitherlink.spec.js` | Playwright suite (57 tests) |

`game.js` deliberately exposes its state and helpers as globals
(`LEVELS`, `state`, `level`, `moves`, `edges`, `startGame`, `setEdge`,
`cycleEdge`, `isSingleLoop`, `isSolved`, `pointerToEdge`, `edgeMidpoint`, …)
so the Playwright suite can drive and inspect the game directly, matching the
convention used by the other games in this repo.

## Testing approach

Written test-first: the whole spec was authored and run red before `game.js`
existed, then implemented until green. The suite covers initial state, level
data integrity (dimensions, clue ranges, in-bounds solution keys, and that
**every stored solution actually solves its level**), edge cycling in both
directions, move accounting, the clue/degree/loop rules including the negative
cases (open path, two disjoint loops, a dot with three lines, a loop that
ignores the clues), winning and best-score persistence, keyboard shortcuts,
pointer-to-edge mapping including real mouse clicks on the canvas, and
rendering.

## Assumptions

These were decisions made without being able to ask, taking the simpler reading
each time:

1. **Branch name.** The task asked for a branch named after the game
   (`slitherlink`), but this session's standing instructions pin all work to the
   assigned branch `claude/loving-euler-lo674v`. The standing instruction wins,
   so the work lives there rather than on a `slitherlink` branch.
2. **Fixed puzzles, not runtime generation.** Generating a uniquely-solvable
   Slitherlink in the browser needs a solver in the hot path. Five pre-generated,
   verified puzzles are simpler and make the tests deterministic.
3. **Win detection is rule-based, not answer-matching.** The game checks the
   clue and loop rules rather than comparing against the stored solution, so any
   valid loop wins. (The bundled puzzles are unique, so in practice this is the
   same set of boards.)
4. **Crosses are optional bookkeeping.** They never block drawing a line and
   never affect solving.
5. **Scoring is move count, lower is better.** No timer — this is an untimed
   logic puzzle, and a clock would push players toward guessing.
6. **No auto-solve or hint button.** Kept out to keep the surface small; the
   colour feedback on clues is the assist.
7. **No mis-move rejection.** Players may draw an obviously illegal
   configuration (three lines at a dot, say); the puzzle simply is not solved.
   Slitherlink is normally played this way on paper.
8. **The win panel is delayed ~0.7s** so the finished loop is visible before the
   overlay covers the board.
