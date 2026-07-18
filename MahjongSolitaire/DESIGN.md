# Mahjong Solitaire — Design

## Concept

The classic single-player tile-matching game. Tiles are arranged in a stacked,
pyramid-shaped layout. Remove tiles by matching **free** pairs of the same face
until the board is clear. A tile is *free* when nothing lies on top of it and at
least one of its left/right sides is open. Every deal is **guaranteed solvable**.

## The board

- 64 tiles across three stacked layers, forming a centred pyramid:
  - **Layer 0** — 5 rows × 8 columns = 40 tiles
  - **Layer 1** — 3 rows × 6 columns = 18 tiles (centred on layer 0)
  - **Layer 2** — 1 row × 6 columns = 6 tiles (centred on layer 1)
- Each cell holds at most one tile per layer (a simplified unit-cell grid — see
  Assumptions). Higher layers are drawn offset up-and-left to give a 3-D look.
- 16 distinct faces, each appearing 4 times (64 = 16 × 4), so any two identical
  free tiles match — just like the four-of-a-kind matching in real Mahjong.

## Mechanics

- **Free tile** (`isFree`): not covered by a tile in the layer directly above
  (same row/column) **and** its left cell *or* right cell (same layer) is empty.
- **Matching**: click a free tile to select it, then click another free tile.
  If they share a face they are both removed; otherwise the selection moves to
  the new tile. Clicking a blocked (non-free) tile does nothing.
- **Win** when every tile is removed.
- **Stuck**: if no two free tiles share a face, there are no legal moves. The
  game says so — use **Undo** to step back, or start a **New Game**.
- **Undo** restores the most recently removed pair (unlimited).
- **Hint** briefly highlights one currently-matchable pair.

## Solvable deal generation

Faces are assigned by *pair-peeling* the empty layout:

1. Start with all 64 positions present.
2. Repeatedly take the set of currently-free positions, pick two at random,
   record them as a pair, and remove them — until the board is empty. This
   yields 32 pairs in a valid removal order.
3. If a step ever finds fewer than two free tiles, discard and retry (rare).
4. Assign each recorded pair a face (two pairs per face → four tiles per face).

Because the recorded pairs were simultaneously free in that order, replaying
them in the same order is always a valid solution — so the deal is guaranteed
solvable. The plan is kept as `solutionPlan` (used by the solvability test and
available as a fallback hint source).

## Controls

- **Mouse / touch** — click a free tile to select, click a matching free tile to
  clear the pair. Click the selected tile again to deselect.
- **H** — hint. **U** — undo. **N** — new game.

## Testability

The rules are pure functions over the global `tiles` array
(`isFree`, `tileAt`, `remaining`, `anyMovesLeft`, `findHint`, `removePair`,
`clickTile`) with no animation dependence, so Playwright tests build exact
board geometries and assert free/matched/win/stuck outcomes deterministically.
The solvability test replays `solutionPlan` and asserts the board clears.

## Assumptions

- **`DESIGN.md` (uppercase).** The task asked for `DESIGN.md`; existing games use
  `design.md`. This folder ships the uppercase name the task specified.
- **Unit-cell layout.** Real Mahjong layouts use half-cell offsets so a tile can
  be half-covered. This game uses a simpler one-tile-per-cell grid, which keeps
  the cover / free rules exact and easy to reason about while preserving the
  layered pyramid look and the free-tile rule. Noted as the simpler interpretation.
- **Identical-face matching only.** Flower/season group-matching from the full
  tile set is omitted; every match is two identical faces.
- **Best time** (fastest solve) persists in `localStorage` under `mahjong-best`.
