# Match-3 — Design

## Concept

Match-3 is a grid puzzle in the spirit of *Bejeweled*. The board is an 8×8 grid
of coloured gems. The player swaps two orthogonally-adjacent gems; if the swap
creates a line of **three or more** gems of the same colour (horizontally or
vertically), those gems clear, everything above falls down to fill the gaps, and
fresh gems drop in from the top. Newly-fallen gems can line up into **further**
matches, producing chain-reaction *cascades* that score more.

It is deliberately distinct from every other game in the repo: it is not a
real-time action game (Snake, Breakout, Asteroids…) and not a sliding/merge
puzzle (2048, Tetris). It is a click-driven, turn-based *swap-to-match* puzzle.

The arcade goal is a classic **move-limited high-score chase**: you start with a
fixed number of moves (20) and try to score as high as possible before they run
out. Cascades are the key to a big score, so the board is a puzzle to be read,
not just a reflex test.

## Mechanics

- **Board** — `board[r][c]` holds a gem *type* (integer `0…NUM_TYPES-1`) or `-1`
  for an empty cell. Grid is `GRID`×`GRID` (8×8); each cell renders at `CELL`
  (60px) so the canvas is 480×480.
- **No free matches at start** — `newBoard()` fills the grid so that no three
  gems already line up, and so that at least one legal move exists.
- **Swap** — `trySwap(a, b)` is the player action:
  1. If `a` and `b` are not orthogonally adjacent → reject (no move spent).
  2. Swap them and look for matches. If none → swap back, reject (no move spent).
  3. Otherwise resolve the board, spend one move, update the score.
- **Match detection** — `findMatches()` scans every row and column for runs of
  ≥3 equal, non-empty gems and returns the set of matched cell coordinates.
- **Resolve loop** — `resolveBoard()` repeats until the board is stable:
  clear the current matches, apply gravity, refill the empty cells from the top,
  then look again. Each pass is a *cascade step*.
- **Gravity** — `applyGravity()` collapses each column so gems rest at the
  bottom and empty cells bubble to the top.
- **Scoring** — each cleared gem is worth 10 points, multiplied by the cascade
  step number: the first clear scores ×1, a cascade it triggers scores ×2, the
  next ×3, and so on. Chains are where the points are.
- **Move limit / game over** — the game starts with `MAX_MOVES` (20) moves.
  Every accepted swap spends one. At zero moves the game ends and the best score
  is persisted to `localStorage` (`match3-best`).
- **Reshuffle** — if, after a resolve, the board has no legal move left, it is
  reshuffled (in real play) so the player is never stuck.

## Controls

- **Mouse / touch** — click (or tap) a gem to select it, then click an adjacent
  gem to swap. Clicking the selected gem again deselects it; clicking a
  non-adjacent gem moves the selection there.
- **Space / Enter / Start button** — start (or restart) the game from the
  idle / game-over overlay.

## Testable surface

To support TDD with Playwright the game logic is exposed as top-level
functions/state (matching the convention used by the other games — no IIFE), and
two deterministic test hooks are provided:

- `setSeed(n)` — seed the internal PRNG so gem generation is reproducible.
- `loadBoard(rows)` — load an exact board from an array of 8 strings (digits are
  gem types, `.` is an empty cell).
- `autoRefill` — a flag (default `true`). Tests set it to `false` so the resolve
  loop does **not** drop in random gems, making clears, gravity, cascades and
  scoring fully deterministic.

## Assumptions

- **Move-limited, not time-limited.** A move counter is fully deterministic and
  therefore cleanly testable, and it makes cascades a strategic choice rather
  than a race. (Simpler interpretation of "arcade high-score chase".)
- **Instant resolve, no fall animation.** Matches clear and gravity applies in a
  single logical step, then the board is redrawn. This keeps game logic and
  rendering decoupled so the same functions the player drives are the ones the
  tests assert on — no timing races. Selection highlighting still gives visual
  feedback.
- **6 gem colours, 8×8 board, 20 moves.** Round, familiar numbers; 6 colours
  keeps accidental matches common enough for satisfying cascades without making
  the board trivial.
- **Canvas is 480×480** (not the 500×500 some other games use) so that an 8-wide
  grid divides into clean 60px cells.
