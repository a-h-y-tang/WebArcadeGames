# Untangle — Design

## Concept

**Untangle** (also known as *Planarity*) is a single-player logic/puzzle game. The
board starts with a tangle of nodes connected by straight-line edges, with many
edges crossing over one another. The player drags nodes around the canvas to
pull the graph apart until **no two edges cross**. Every puzzle is guaranteed to
have at least one crossing-free (planar) layout, so it is always solvable.

The goal is to reach zero crossings in as few moves as possible.

## Why it is always solvable

Puzzles are generated from a **triangulation of points in convex position**:

1. `n` nodes are assigned angles evenly spaced (with a small random jitter)
   around a circle. Because all the "solution" points lie on a circle, they are
   in convex position.
2. Boundary edges connect consecutive nodes around the circle.
3. Interior diagonals are added by a recursive convex-polygon triangulation
   (`triangulate(lo, hi)` picks a random apex `k` inside the span, adds edges
   `lo–k` and `k–hi`, then recurses on both halves). Every diagonal it adds is a
   chord of a convex polygon, so **no two generated edges cross** in the circle
   layout.

The circle layout is therefore a guaranteed crossing-free solution. The game
then **scrambles** the displayed node positions to random spots on the canvas
(the solution circle positions are discarded — the player finds their own
untangling, which need not match the original circle).

Because any subset of non-crossing edges is still non-crossing, the graph is a
maximal planar graph (a triangulation) with `2n − 3` edges, which makes a dense,
satisfying tangle.

## Mechanics

- **Crossing**: two edges *properly* cross when their segments intersect at a
  point interior to both. Edges that merely share an endpoint (they always do,
  at every node) never count as a crossing.
- **Crossings counter**: the number of properly-crossing edge pairs at the
  current positions. The puzzle is **solved** when this reaches `0`.
- **Moves**: each completed node drag (mouse/touch down → up with a position
  change) counts as one move. Fewer is better; the best (lowest) winning move
  count per difficulty is saved to `localStorage`.
- **Difficulty**: chooses the node count — Easy `6`, Medium `9`, Hard `12`.
  More nodes ⇒ more edges ⇒ more initial crossings.

## Controls

- **Mouse**: click and drag a node to move it. Release to drop.
- **Touch**: touch and drag a node (single finger).
- **Buttons**: `Easy` / `Medium` / `Hard` pick difficulty and start a fresh
  puzzle. `New Puzzle` reshuffles the current difficulty.
- **Keyboard**: `N` / `R` for a new puzzle; `1` / `2` / `3` set Easy / Medium /
  Hard.

## Rendering

- 500×500 canvas, dark theme matching the rest of the arcade.
- Edges drawn as lines; crossing edges tinted red, non-crossing edges cyan, so
  the player can see what still needs work.
- Nodes drawn as filled circles; the node under the cursor / being dragged is
  highlighted.
- A win overlay appears on reaching zero crossings, showing the move count.

## Exposed API (for the test-suite)

Globals are intentionally exposed on `window` so the Playwright suite can drive
the game deterministically:

- State: `nodes` (`[{x,y}]`), `edges` (`[[a,b], …]`), `state`
  (`'idle' | 'running' | 'won'`), `moves`, `difficulty`, `nodeCount`.
- Lifecycle: `startGame(seed)` — builds a deterministic puzzle from a numeric
  seed via a seedable `mulberry32` PRNG; `setDifficulty(name)`.
- Geometry: `segmentsIntersect(p1,p2,p3,p4)`, `countCrossings()`,
  `isSolved()`.
- Interaction: `moveNode(i, x, y)`, `nodeAt(x, y)` (hit test → index or `-1`).

## Assumptions

- **Solvable-only, not unique-solution**: puzzles guarantee a planar layout
  exists; they do *not* guarantee it is the only one. Any crossing-free
  arrangement the player reaches wins. (Simpler interpretation, per the task's
  "pick the simpler interpretation" guidance.)
- **Move counting**: a "move" is one drag that actually changes a node's
  position. A click that does not move a node, or a drag that starts off any
  node, counts as nothing.
- **Proper intersection only**: degenerate collinear-overlap crossings are
  ignored. With randomized float positions these effectively never occur, and
  treating them as non-crossings never makes a solved board look unsolved.
- **Difficulty node counts** (6 / 9 / 12) were chosen to keep Easy quick and
  Hard challenging while fitting legibly on a 500×500 canvas.
- **Best score** is stored per difficulty in `localStorage` under
  `untangle-best-<n>`; missing values render as an em dash.
