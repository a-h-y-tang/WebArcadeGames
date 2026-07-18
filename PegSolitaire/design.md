# Peg Solitaire — Design

## Concept

A single-file, canvas implementation of the classic **Peg Solitaire** (the
English cross board). The board is a plus-shaped grid of 33 holes. It starts
full of pegs except for the centre. On each move you jump one peg straight over
an adjacent peg into the empty hole beyond it, removing the jumped peg. The goal
is to clear the board down to a **single peg** — ideally in the centre.

## The board

A 7×7 grid with the four 2×2 corners cut away, leaving a cross of **33 cells**.
`board[r][c]` holds one of:

- `INVALID (-1)` — a cut corner, not part of the board
- `EMPTY (0)` — a hole with no peg
- `PEG (1)` — a hole with a peg

A cell is a real hole when it is in bounds and lies in the vertical bar
(`2 ≤ c ≤ 4`) **or** the horizontal bar (`2 ≤ r ≤ 4`). The opening position fills
every hole with a peg except the centre `(3,3)`, giving **32 pegs**.

## Moves

A move jumps a peg two cells in one of the four orthogonal directions:

- The **source** `(r,c)` holds a peg.
- The **middle** cell (one step toward the target) holds a peg.
- The **target** `(r±2, c)` or `(r, c±2)` is an empty hole.

Applying the jump empties the source and middle cells and fills the target — one
peg removed per jump. Diagonal jumps are not allowed.

- `jumpTarget(fr,fc,tr,tc)` returns the jumped middle cell if the jump is legal,
  or `null`.
- `movesFrom(r,c)` lists every legal target for the peg at `(r,c)`.
- `allMoves()` lists every legal `{from,to}` on the board.
- `applyJump(fr,fc,tr,tc)` performs a legal jump.

## Controls

Two-click selection:

1. **Click a peg** to select it (selectable pegs — those with at least one legal
   jump — are highlighted).
2. **Click a highlighted empty hole** to jump the selected peg there.

Clicking another peg re-selects it; clicking elsewhere clears the selection.
Click **Start / Play Again**, or press any key, to begin or restart.

## Scoring, win & lose

- `score` counts pegs removed (each jump = +1). Starting with 32 pegs, clearing
  to one peg scores **31**.
- When no legal move remains the game ends:
  - **1 peg left → "Solved!"** (a perfect finish adds a note if it's the centre).
  - **more than 1 peg → "Stuck!"**
- `best` (persisted to `localStorage` under `peg-solitaire-best`) tracks the most
  pegs you have ever removed in a game — higher is better.

## Rendering

Pure Canvas 2D: sunken circular holes on a wooden-toned board, pegs drawn as
shaded domes, the selected peg ringed, and translucent target dots on the holes
it can jump to. A HUD shows pegs left, pegs removed (score), and your best.

## Assumptions

Choices that resolve ambiguities toward the simplest faithful interpretation:

1. **File naming.** The repo convention is a lowercase `design.md` per game, so
   this file is `design.md` despite the task brief saying `DESIGN.md`. The
   Assumptions section lives here.
2. **English cross board** (33 holes) rather than the European/other variants —
   the most widely recognised layout.
3. **No forced-capture or single-peg-path rules.** Any legal jump may be played;
   the game simply ends when no jumps remain. This keeps the rules approachable.
4. **"Best" = most pegs removed.** Peg Solitaire has no running score, so the
   repo's `best` slot tracks the largest number of pegs you have cleared in a
   finished game.
5. **Move hints are always on** (selectable pegs and legal targets are shown) to
   keep the puzzle approachable.
