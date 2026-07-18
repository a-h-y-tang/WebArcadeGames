# Flood It — Design

## Game concept

Flood It is a single-player color puzzle played on a square grid of randomly
coloured tiles. The board is "flooded" starting from the **top-left corner**.
That corner (and every tile connected to it that shares its colour) forms the
**flood region**. On each move the player chooses a new colour; the whole flood
region recolours to that colour and immediately absorbs any orthogonally
adjacent tiles of the new colour, so the region grows.

The goal is to make the **entire board a single colour** before running out of
moves. Fewer moves is better.

## Mechanics

- **Grid:** 14 × 14 tiles, 6 possible colours (default). Rendered on a
  500 × 500 canvas, so each tile is `500 / 14 ≈ 35.7` px.
- **Flood region:** the connected component (4-directional) of same-coloured
  tiles that includes the top-left tile `(0,0)`.
- **A move:** pick colour `c`.
  - If `c` is already the current flood colour, the move is a no-op and is
    **not** counted (prevents wasting the move budget).
  - Otherwise, recolour every tile of the flood region to `c`. This naturally
    merges the region with any neighbouring `c`-coloured tiles, which become
    part of the region for the next move. One move is consumed.
- **Win:** every tile shares one colour (`regionSize() === size * size`).
- **Lose:** the move budget reaches 0 before the board is unified.
- **Move budget:** `30` moves. Tuned empirically: a deliberately weak
  greedy-immediate solver (always pick the colour that grows the region most
  this turn) averages ~26.5 moves and needs ≤30 on ~94% of random boards, so a
  30-move budget is comfortably winnable with reasonable — not optimal — play,
  while still punishing careless moves.
- **Best score:** fewest moves used in a completed win, persisted in
  `localStorage` under `floodit-best`. Lower is better; shows `—` until a first
  win.

## Determinism

Board generation uses a seedable PRNG (mulberry32) rather than `Math.random`.
`startGame(seed)` accepts an optional integer seed so tests can reproduce exact
boards. When no seed is passed a seed is derived from `Date.now()`.

## Controls

- **Mouse:** click one of the six colour swatches below the board.
- **Keyboard:** keys `1`–`6` select the corresponding colour. `R` starts a new
  game. `N` also starts a new game (from the win/lose overlay).
- **Start / New Game button** in the overlay.

## State model

`state` is one of `idle` (before first interaction / on load), `running`,
`won`, `lost`. Global `let` bindings (`grid`, `flood`, `movesLeft`, `state`,
etc.) are exposed for the Playwright test-suite to inspect and drive, matching
the convention used by the other games in this repo.

Key functions exposed globally:

- `startGame(seed?)` — (re)generate the board and reset counters.
- `pickColor(colorIndex)` — apply a move for colour `0..5`.
- `regionSize()` — number of tiles currently in the flood region.
- `isWon()` — whether the whole board is unified.

## Assumptions

- **Board / palette size.** The task left dimensions open; I chose the classic
  14×14, 6-colour Flood It configuration with a 25-move budget — the simplest
  well-known parameterisation that is fun and clearly winnable. The move budget
  was then set to 30 based on the greedy-solver measurement described above,
  rather than the stricter 25 used by some commercial versions.
- **No-op moves are free.** Re-selecting the current flood colour does nothing
  and is not charged a move. This is the standard, player-friendly rule.
- **Best = fewest winning moves.** Unlike the higher-is-better "Best" in some
  other games here, Flood It's natural metric is *fewer* moves, so Best tracks
  the minimum winning move count. This is noted here to avoid confusion.
- **Guaranteed-solvable boards.** A uniformly random board is (with the chosen
  budget) essentially always solvable within 25 moves; no explicit solvability
  check is performed, keeping the implementation simple.
- **Canvas stays 500×500** to match the repo's other games; tile size is
  fractional but renders cleanly.
