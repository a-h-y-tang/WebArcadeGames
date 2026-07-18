# Hashi (Bridges) — Design

## Concept

**Hashi** (short for *Hashiwokakero*, "build bridges"; also called **Bridges**) is a
logic puzzle. The board holds a set of numbered **islands**. The goal is to connect
them with **bridges** so that:

1. Every bridge runs horizontally or vertically in a straight line between two
   islands.
2. Between any pair of islands there are **at most two** bridges.
3. Bridges never **cross** each other and never pass over an island.
4. Each island ends up with **exactly its number** of bridges attached.
5. All islands form a **single connected group**.

The puzzle is solved when every island's number is satisfied and the whole network
is connected.

## Mechanics

- Islands live on a square grid; each stores its grid position and required bridge
  count (`req`).
- Two islands are **neighbours** if they share a row or column with a clear straight
  line between them (no island in between).
- A bridge between a neighbour pair has a count of **0, 1 or 2**. Toggling a pair
  cycles `0 → 1 → 2 → 0`.
- **Crossing rule:** a new bridge cannot be placed if its span would share a cell
  with an existing *perpendicular* bridge. Such a toggle is rejected (no-op).
- An island's **degree** is the sum of its bridge counts; it is *satisfied* when the
  degree equals `req`.
- **Connectivity** is a breadth-first search over islands linked by bridges with a
  positive count.

### Win / scoring

- The HUD shows how many islands are satisfied (`satisfied / total`) and a **move**
  counter (one per successful bridge toggle).
- `isSolved()` is true when every island is satisfied *and* all islands are
  connected. Reaching it sets `state = 'won'`.
- The best (fewest) move count per level is stored in `localStorage`
  (`hashi-best-<level>`), lower being better.

## Controls

- **Click an island, then click a neighbour** to toggle the bridge between them.
- **Or drag** from one island to a neighbouring island.
- Clicking an island toggles its selection; clicking empty space clears it.
- **R:** restart the current level.
- **N:** advance to the next level.
- **Level buttons:** jump directly to a level.

## Levels

Three hand-crafted puzzles, each built from a known valid solution so it is
guaranteed solvable with all islands satisfied and connected:

| Level | Grid | Islands | Notes |
|---|---|---|---|
| 1 | 5×5 | 4 | Corner loop — a gentle introduction |
| 2 | 7×7 | 9 | 3×3 lattice with double bridges |
| 3 | 5×5 | 8 | Octagon; interior pairs create crossing choices |

## Code structure

`game.js` exposes a compact, rendering-independent API on the global scope so the
Playwright suite can drive the puzzle deterministically:

- State: `GRID`, `state` (`'ready' | 'running' | 'won'`), `level`, `islands`
  (list of `{r, c, req}`), `bridges` (pair key → count), `moves`, `LEVELS`.
- Actions: `startGame(level)`, `toggleBridge(i, j)`.
- Queries: `neighborsOf(i)`, `bridgeCount(i, j)`, `islandDegree(i)`,
  `isSatisfied(i)`, `satisfiedCount()`, `allConnected()`, `isSolved()`,
  `islandIndexAt(r, c)`, `pointerToCell(x, y)`.

Rendering is a plain 2-D canvas: grid dots, single/double bridge lines, and numbered
island discs (green when satisfied). All logic is pure and unit-testable.

## Assumptions

Where the task was ambiguous, the simpler interpretation was chosen and recorded
here:

- **Scoring is move count, not a timer.** Lower is better; simplest to test.
- **Puzzles are hand-crafted from a known solution** rather than procedurally
  generated. This guarantees each shipped level is solvable. Puzzles may admit more
  than one solution (uniqueness is not enforced) — correctness and solvability were
  prioritised over guaranteeing a single answer.
- **Toggling cycles 0 → 1 → 2 → 0.** There is no separate "erase" gesture; cycling
  past two removes the bridge.
- **A rejected (crossing) toggle is a silent no-op** and does not count as a move.
- **Bridges are undirected**; a pair is stored under one canonical key regardless of
  which island the player started from.
