# Gem Crush — Design

## Concept

Gem Crush is a match-3 puzzle game on an 8×8 board of coloured gems. The
player swaps two adjacent gems to line up three or more of the same colour.
Matched gems clear, the gems above fall down to fill the gaps, and fresh gems
drop in from the top. A single swap can trigger **cascades** — when falling
gems form new matches, they clear too, and each cascade in the chain is worth
more points.

The game is endless until the board **deadlocks**: when no possible swap can
create a match, the game is over.

## Mechanics

### Board

- 8 columns × 8 rows of gems, each gem one of **6 colours**.
- The starting board is generated so that it contains **no pre-existing
  matches** (the player always has to make the first match themselves).

### Swapping

1. Click a gem to select it (it is highlighted).
2. Click an **orthogonally adjacent** gem to attempt a swap.
   - If the swap creates at least one match, the swap sticks and the board
     resolves (see Cascades).
   - If the swap creates **no** match, it is reverted and nothing changes —
     the selection clears.
3. Clicking the selected gem again deselects it. Clicking a non-adjacent gem
   moves the selection to the new gem.

### Matching

- A match is a run of **3 or more** gems of the same colour in a straight
  horizontal or vertical line.
- All matched cells across the whole board are cleared simultaneously.

### Cascades and scoring

After a successful swap the board is resolved in a loop:

1. Find all matches. If none, stop.
2. Clear the matched gems and award points:
   `points = (gems cleared) × 10 × (cascade level)`.
   The first clear from a swap is cascade level 1, the next chained clear is
   level 2, and so on — so long chains score progressively more.
3. Apply gravity: in every column, remaining gems fall to the bottom.
4. Refill: empty cells at the top of each column are filled with new random
   gems.
5. Repeat from step 1.

### Game over

After each successful swap resolves, the game checks whether **any** adjacent
swap anywhere on the board could still produce a match. If none can, the board
is deadlocked and the game ends. The player's score is shown and the best
score is stored.

## Controls

- **Mouse click** — select a gem, then click an adjacent gem to swap.
- **Start / Play Again button** (or any key from the overlay) — begins a new
  game.

## Assumptions

These choices were made where the brief was open-ended; the simpler
interpretation was taken each time and recorded here:

- **Endless play with a deadlock end-condition.** Rather than a move limit or a
  timer, the game runs until the board has no possible matching move. This is a
  natural, self-contained failure state and is fully deterministic to test.
- **Instant resolution, no swap/fall animation timing.** Matches clear and gems
  fall in a single synchronous resolve step. Animation would add visual polish
  but not change the game logic; keeping it synchronous makes the mechanics
  crisp and reliable to test. A subtle selection highlight and per-gem shapes
  provide the visual feedback.
- **6 gem colours,** each also drawn with a distinct shape so the board is
  readable without relying on colour alone.
- **Scoring** is 10 points per cleared gem, multiplied by the cascade level, so
  chain reactions are rewarded. No separate "big match" bonus beyond the number
  of gems cleared.
- **Best score** persists in `localStorage` under the key `gemcrush-best`.

## Code structure

- `index.html` — canvas, HUD (score / best), overlay, and a controls hint.
- `style.css` — dark arcade theme consistent with the other games in the repo.
- `game.js` — all game logic. Key pieces, all exposed as globals so the test
  suite can drive them directly:
  - `board` — 2D array `[row][col]` of colour indices (or `null` mid-resolve).
  - `findMatches(b)` — returns a `Set` of `"r,c"` keys that are part of a run
    of 3+.
  - `swapCells(a, b)` — swaps two cells in place.
  - `applyGravity(b)` / `refill(b)` — column gravity and top-up.
  - `resolveBoard()` — the cascade loop; returns points scored.
  - `trySwap(a, b)` — swap, keep-if-match-else-revert, resolve; returns whether
    it stuck.
  - `hasValidMove(b)` — true if any adjacent swap could produce a match.
  - `handleCellClick(r, c)` — selection + swap driver wired to canvas clicks.
  - `draw()` — renders the board, gems, and selection highlight.

The board functions operate on whatever board array they are given (using its
own dimensions), which lets tests inject small hand-crafted boards to verify
match detection, gravity, and deadlock handling deterministically.
