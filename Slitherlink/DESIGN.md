# Slitherlink — Design

How the code works: data model, puzzle generation, solving/uniqueness checking,
input handling, rendering, and the assumptions made while building it.

## Game concept

Slitherlink (also known as Loop the Loop / Fences) is a Japanese pencil puzzle.
The board is a grid of cells surrounded by a lattice of dots. Some cells carry a
clue between `0` and `3`. The player draws line segments between orthogonally
adjacent dots so that:

1. every clue cell is bordered by **exactly** that many drawn segments, and
2. the drawn segments form **one single closed loop** that never branches and
   never crosses itself.

Every generated puzzle has exactly one solution, so the puzzle can always be
finished by deduction alone — no guessing is required in principle.

## Controls

| Input | Action |
|---|---|
| Left click on an edge | Cycle that edge: empty → line → cross → empty |
| Right click on an edge | Cycle backwards: empty → cross → line → empty |
| `N` | New puzzle at the current difficulty |
| `U` | Undo the last edge change |
| `R` | Clear the board (keeps the same puzzle) |
| `H` | Hint — reveal one correct edge |
| `1` / `2` / `3` | Easy (5×5) / Medium (7×7) / Hard (9×9) |

A "cross" is a player annotation meaning *no line here*; it is bookkeeping only
and never counts toward a clue.

## Files

| File | Role |
|---|---|
| `index.html` | Static markup: HUD, canvas, overlay, control buttons |
| `style.css` | Dark arcade-cabinet styling shared in spirit with the other games |
| `game.js` | Everything else: model, generator, solver, input, rendering |
| `tests/slitherlink.spec.js` | Playwright suite driving the page and the exposed model |

`game.js` is loaded as a classic (non-module) script, so its top-level
declarations are globals. The Playwright tests drive the real game through those
globals (`newGame`, `setEdge`, `isSolved`, …) in addition to clicking the canvas,
which keeps the tests honest without adding a build step.

## Data model

* `R`, `C` — number of cell rows/columns (square: 5, 7 or 9).
* `clues[r][c]` — `0..3`, or `-1` for an unclued cell.
* `H[r][c]` — horizontal edge between dots `(r,c)` and `(r,c+1)`;
  `(R+1) × C` of them. `H[r][c]` is the *top* edge of cell `(r,c)`.
* `V[r][c]` — vertical edge between dots `(r,c)` and `(r+1,c)`;
  `R × (C+1)` of them. `V[r][c]` is the *left* edge of cell `(r,c)`.
* Edge states: `EMPTY = 0`, `LINE = 1`, `CROSS = 2`.
* `solution` — `{H, V}` for the unique loop, used by `hint()` and by the tests.

So the four edges of cell `(r,c)` are `H[r][c]`, `H[r+1][c]`, `V[r][c]`,
`V[r][c+1]`.

## Inside/outside formulation

The whole generator and solver work on **cell labels** rather than edges. Label
each cell `IN` or `OUT` (everything beyond the grid is `OUT`); an edge is a line
exactly when the two cells it separates carry different labels. This is the key
simplification:

* A clue is then simply "how many of my four neighbours differ from me",
  with off-grid neighbours counting as `OUT`.
* Every dot automatically has an **even** number of incident lines, because
  walking the four cells around a dot in a cycle must change label an even number
  of times. Degree 0 and 2 are fine; degree 4 is the only illegal case and
  happens exactly at a *diagonal pinch* (`a == d && b == c && a != b` for the
  four cells `a b / c d` around the dot).

A labelling therefore describes a single simple closed loop iff:

1. the `IN` region is non-empty and 4-connected,
2. the `OUT` region *including the exterior* is 4-connected (i.e. the `IN` region
   has no holes), and
3. no dot is a diagonal pinch.

`regionValid()` checks exactly those three conditions and is used by the
generator, the solver and the win check alike.

## Puzzle generation

1. **Grow a region.** Start from the centre cell. Repeatedly pick a random cell
   and toggle its membership, keeping the toggle only if `regionValid()` still
   holds, biased toward growth until the region covers roughly 35–55% of the
   grid. The result is a random blob whose boundary is a single simple loop.
2. **Derive full clues.** Every cell gets the number of its edges on the boundary.
3. **Carve clues away.** Walk the cells in random order and try removing each
   clue, keeping the removal only if the puzzle still has exactly one solution.
   Typical results: ~9/25 clues on Easy, ~19/49 on Medium, ~31/81 on Hard.

Generation is seeded (`mulberry32`), so `newGame('easy', 42)` is reproducible —
which the tests rely on.

## Solver / uniqueness

`countSolutions(clues, R, C, maxSolutions, budget)` is a depth-first search that
labels cells in row-major order and stops as soon as it has found `maxSolutions`
solutions. Pruning at each assignment:

* **Clue bounds** for the just-assigned cell and its already-assigned up/left
  neighbours: with `known` differing neighbours and `unknown` unassigned ones,
  the clue must satisfy `known ≤ clue ≤ known + unknown`.
* **Dot pinch**: the dot at the top-left corner of the cell just assigned is now
  surrounded by four assigned cells, so a diagonal pinch is rejected immediately.
  This kills checkerboard branches very early.

Connectivity is only checked on complete labellings (via `regionValid()`), which
is cheap because the pruning above leaves very few complete candidates.

The search carries a **node budget**. If a removal test blows the budget, the
generator conservatively treats the puzzle as "not provably unique" and keeps the
clue. That bounds generation time — measured worst case is well under a second
for 9×9 — at the cost of occasionally leaving one more clue than strictly needed.

## Win detection

`isSolved()` works directly on the drawn edges rather than on labels, so it
validates what the player actually drew:

1. at least one line exists,
2. every dot has degree 0 or 2 (no branches, no pinches),
3. all lines are in one connected component (single loop, not several), and
4. every clue equals the number of `LINE` edges around its cell (crosses ignored).

It is re-run after every edge change; on success the timer stops, the board locks
and the overlay reports the time, with best times per difficulty persisted in
`localStorage` under `slitherlink-best-<difficulty>`.

## Input handling

`edgeAtPoint(x, y)` converts canvas pixels to grid units, then compares the
distance to the nearest horizontal edge line with the distance to the nearest
vertical one and picks the closer, rejecting anything further than `0.4` cells
away (so clicks in the middle of a cell do nothing). Every accepted change goes
through `applyEdge()`, which records `{kind, r, c, previous}` on an undo stack.

## Rendering

A single `draw()` on `requestAnimationFrame` paints: the dot lattice, clue digits
(dimmed when the clue is already satisfied, red when too many lines surround it),
crosses as small grey ×, and lines as thick rounded strokes that glow when the
puzzle is solved. Canvas is a fixed 560×560; dot spacing is derived from the grid
size so all three difficulties fill the same box.

## Assumptions

Made autonomously while building this, per the "pick the simpler interpretation"
instruction:

* **Branch name.** The task asked for a branch named after the game
  (`slitherlink`), but this session is pinned to the branch
  `claude/loving-euler-0nw3yq`, and that constraint wins. All work lives there.
* **Three fixed difficulties** — 5×5, 7×7, 9×9 — rather than arbitrary board
  sizes, because generation cost grows quickly and 9×9 already takes under a
  second.
* **Click cycles through three states** (empty → line → cross) instead of
  supporting click-and-drag path drawing. Dragging is nicer on a big screen but
  much harder to test deterministically, and the cycle is the common
  implementation on the web.
* **Crosses are optional annotations.** The puzzle can be completed without ever
  placing one; they never affect win detection.
* **Uniqueness is budget-bounded.** Puzzles are guaranteed to have at least one
  solution and are verified unique within the search budget; on the rare budget
  exhaustion the generator keeps the clue rather than risking ambiguity.
* **Hints reveal an edge, not a deduction.** `hint()` fills in one edge that
  currently disagrees with the stored solution, choosing lines before crosses so
  the hint is visibly useful. Hints are counted and shown in the HUD but do not
  disqualify a best time (kept simple).
* **No sound.** Consistent with the rest of the repo's newer games.
