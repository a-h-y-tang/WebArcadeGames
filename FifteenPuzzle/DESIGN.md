# 15 Puzzle (Sliding Tile Puzzle) — Design

## Concept

The 15 Puzzle is a classic sliding-tile puzzle: a 4×4 grid holds fifteen
numbered tiles (1–15) and one empty space. Tiles orthogonally adjacent to the
empty space can slide into it. The goal is to arrange the tiles in ascending
order (1–15) with the empty space in the bottom-right corner, in as few moves
as possible.

It runs entirely in the browser on an HTML5 `<canvas>` — no build step. Open
`index.html`.

## Mechanics

- The board is a flat array of 16 values indexed `row * 4 + col`. Value `0` is
  the empty space; `1`–`15` are the tiles.
- A tile can move only if it is orthogonally adjacent to the empty space. Moving
  it swaps the tile and the empty space and increments the **move counter**.
- **Solved** state is `[1, 2, …, 15, 0]` — tiles in order with the empty space
  last.
- **Shuffling** is done by applying a large number of *random legal moves*
  starting from the solved board. This guarantees the scramble is always
  solvable (it avoids the unsolvable half of all 16! permutations that a naive
  random shuffle would produce). The shuffle repeats if it happens to land back
  on the solved arrangement.
- A **timer** counts up from the first move and stops on solve. The best score
  per metric — fewest moves and fastest time — is stored in `localStorage`.

## Controls

| Input | Action |
|---|---|
| **Click** a tile next to the empty space | Slide it into the space |
| **Arrow keys** | Slide the tile on that side of the empty space in the arrow's direction |
| **New Game** button | Reshuffle into a fresh solvable scramble |

Arrow-key convention: the arrow names the direction a *tile* moves. `→` slides
the tile immediately left of the empty space to the right; `↑` slides the tile
below the empty space up; and so on. If there is no tile in that position
(the empty space is against that edge), the key does nothing.

## Rendering

- Canvas is 500×500. Tiles are drawn as rounded rectangles with the number
  centred; the empty space is left blank. A tile that can currently move is
  tinted slightly brighter as an affordance.
- Move count and elapsed time are shown in the HUD above the board; a win
  overlay fades in on solve with the final move count and time.

## Testable surface

Globals and pure helpers are exposed on `window` for Playwright:

- `board`, `blankIndex`, `moves`, `state`, `SIZE`.
- `isSolved()`, `canSlide(index)`, `slideTile(index)` — the same path clicks use.
- `moveByArrow(key)` — the same path key presses use.
- `newGame()`, `shuffle(n)`, `setBoard(arr)` (test helper).
- `cellCenter(index)`, `indexAtPixel(x, y)` for canvas-click tests.

## Assumptions

- **Solvability via legal-move shuffling.** Rather than shuffle randomly and
  compute the permutation parity, the scramble is built from random legal moves,
  which is always solvable by construction. This is the simpler interpretation
  and needs no parity maths.
- **4×4 only.** The classic size. The code is written around `SIZE = 4`; other
  sizes are out of scope to keep the game focused.
- **Move counting.** Every successful slide counts as one move, including slides
  that undo a previous move. There is no penalty or "undo" affordance — the
  simplest, most predictable rule.
- **Arrow semantics.** The arrow names the tile's movement direction (not the
  empty space's). This matches how most digital sliding puzzles behave and is
  documented in the controls above.
- Best scores are stored under `localStorage` keys `fifteen-best-moves` and
  `fifteen-best-time`; an empty store shows `--`.
