# Untangle — Design

> Note on file naming: the repo convention (and the root README) is a lowercase
> `design.md` per game, so this file uses that name. It doubles as the
> `DESIGN.md` the project brief asks for and covers every required section:
> concept, mechanics, controls, and assumptions.

## Game concept

Untangle (also known as *Planarity*) is a graph-drawing puzzle. You are given a
tangled web of dots (nodes) joined by lines (edges). The lines start out
crossing each other in a knotted mess; your job is to drag the dots around until
**no two lines cross**. Every puzzle is built from a graph that is *guaranteed*
to have a crossing-free layout, so a solution always exists — finding it is the
fun.

## Why it always has a solution

Each level's graph is generated to be **planar** by construction. Starting from
a single triangle, the generator repeatedly picks a triangular face, drops a new
node **inside** it, and connects that node to the face's three corners. Because
every new node sits strictly inside an existing triangle, the drawing never
gains a crossing — the construction positions themselves are a valid,
crossing-free layout. By Fáry's theorem any planar graph also has a
*straight-line* crossing-free drawing, which is exactly what the player is
looking for. The construction layout is kept as a known "solution" (used only to
prove solvability in the test suite); the puzzle you actually see is that same
graph with every node **scrambled** to a random position.

## Mechanics

- The world is a set of **nodes** (each an `{x, y}` point on the canvas) and
  **edges** (unordered index pairs `[i, j]`).
- A pair of edges **crosses** when their line segments intersect and the two
  edges do **not** share a node (edges that meet at a shared node are *adjacent*,
  not crossing).
- Segment intersection uses the standard orientation (cross-product) test, with
  collinear/touching segments also treated as intersecting.
- **Crossing count** is the number of crossing edge pairs. The puzzle is
  **solved** the instant that count reaches **zero**.
- **Dragging** a node updates its position (clamped to the canvas); the crossing
  count and the red highlight update live as you drag. Releasing a drag that
  actually moved a node counts as one **move**.
- Edges currently involved in a crossing are drawn **red**; clean edges are grey,
  and the whole graph turns green when solved.

## Controls

| Input                     | Action                              |
|---------------------------|-------------------------------------|
| Mouse / touch drag        | Move a dot                          |
| **R**                     | Reset the level to its start layout |
| **N**                     | Next level                          |
| On-screen buttons         | Reset · Next                        |

The start overlay is dismissed with the Start button; a win overlay appears the
moment the last crossing is removed, with a button to advance.

## Determinism & testability

All game logic is pure with respect to the DOM and exposed on `window`:
`moveNode`, `pickNode`, `countCrossings`, `solutionCrossings`, `isSolved`,
`loadLevel`, `loadCustomGraph`, `reset`, and the `segmentsIntersect` primitive,
plus the `nodes`, `edges`, `state`, `level`, and `moves` state. Levels are
generated from a fixed integer **seed** with a small deterministic RNG
(mulberry32), so a level's graph and its scrambled start are identical on every
load and `reset` is exact. Tests drive everything by feeding exact custom graphs
and asserting on crossing counts — no reliance on rendered pixels, timing, or
unseeded randomness.

## Assumptions

- **Simpler interpretation, per the brief.** Levels are generated as *maximal
  planar* graphs (a clean, always-solvable family) rather than arbitrary planar
  graphs, and the solution used for verification is the construction layout
  rather than a re-optimised one.
- **Straight-line edges only** — every edge is a straight segment, so Fáry's
  theorem guarantees the generated graphs are solvable by moving points alone.
- **A move = a completed drag** that repositioned a node; the per-level **best**
  is the fewest moves to solve, saved in `localStorage`. Direct `moveNode` API
  calls (used by tests) do not inflate the move counter — only real drags do.
- **Scrambled starts are re-rolled** deterministically in the rare event a random
  layout happens to be crossing-free, so a level never opens already solved.
- **Levels bundled in `game.js`** as seed configs, so the game runs from
  `file://` with no server or build step, matching every other game in this repo.
- The stray top-level `GeoDash/` folder is unrelated to this game and is left
  untouched.
