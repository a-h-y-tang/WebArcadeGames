# SameGame — Design

## Game concept

**SameGame** (a.k.a. *Chain Shot!*, 1985) is a single-player tile-clearing
puzzle. The board is a grid packed with coloured tiles. Click any tile that is
part of a **connected group of two or more same-coloured tiles** (connected
orthogonally — up/down/left/right) and the whole group vanishes. Tiles above an
emptied space **fall down** to fill it, and any **column left completely empty**
is removed by sliding the columns to its right leftward. Bigger groups score
disproportionately more, so the goal is to plan removals that build large blobs.
The game ends when no group of two or more remains; clearing the **entire board**
earns a large bonus.

It is mechanically distinct from the repo's other coloured-tile games:
- **Match-3 / gem swappers** *swap* two adjacent tiles to make lines of exactly
  three; the board is kept full by refilling from the top.
- **Tetris / Columns** drop an active falling piece.
- **Flood-It** recolours a growing region from one corner.
- **SameGame** never refills. You *remove* connected regions of any shape; the
  board only shrinks, and every move permanently changes the layout. The skill
  is in the ordering — merge small blobs into big ones before clearing.

## The board

- Grid is **14 columns × 10 rows** (`COLS = 14`, `ROWS = 10`).
- Canvas is `504 × 360` (36px tiles).
- There are **4 tile colours** (indices `0..3`).
- `board[r][c]` holds a colour index or `null` for an empty cell. Row 0 is the
  top; gravity pulls tiles toward the bottom (row `ROWS-1`).

## Mechanics

- **Groups:** `groupAt(r, c)` flood-fills the connected same-colour region
  containing `(r, c)` (4-directional) and returns its cells.
- **Removing:** `removeGroup(r, c)` removes the group if it has **≥ 2** tiles
  (a lone tile does nothing), then settles the board and scores. It returns the
  number of tiles removed.
- **Gravity:** `applyGravity()` lets the tiles in each column fall to rest on the
  floor or on the tiles beneath them.
- **Column collapse:** `collapseColumns()` deletes any fully-empty column by
  packing the remaining (non-empty) columns to the left, preserving their order.
- **Scoring:** removing a group of `n` tiles scores `n × (n − 1)` points
  (`scoreFor(n)`): 2 tiles → 2, 3 → 6, 4 → 12, 5 → 20, 10 → 90. The quadratic
  growth is what rewards building big groups.
- **Clear bonus:** emptying the whole board adds `CLEAR_BONUS = 1000`.
- **Game over:** after a removal, if no group of ≥ 2 exists anywhere
  (`hasMoves()` is false) the game ends. A fresh deal is re-rolled until it
  contains at least one legal move.

## Controls

SameGame is mouse-driven:

| Input | Action |
|---|---|
| Hover a tile | Highlights the group it belongs to and previews the points |
| Click a group of 2+ | Removes it |
| Click board / Start button (idle) | Starts a new game |
| Click Play Again (game over) | Deals a new board |

## State & structure

- `state` is one of `'idle' | 'running' | 'over'`.
- The game exposes its internals (`board`, `state`, `score`, `groupAt`,
  `removeGroup`, `applyGravity`, `collapseColumns`, `hasMoves`, `isCleared`,
  `tilesLeft`, `scoreFor`, `startGame`, `endGame`, …) as globals so the
  Playwright suite can drive and inspect it deterministically.
- Best score persists to `localStorage` under `samegame-best`.
- Files: `index.html` (markup), `style.css` (presentation), `game.js` (logic +
  rendering), `tests/samegame.spec.js` (Playwright suite).

## Assumptions

Choices made to resolve ambiguities toward the **simpler** interpretation:

1. **One-click removal, no confirm step.** The arcade original often uses a
   select-then-confirm two-click flow; hovering already previews the group and
   score, so a single click removes it. This keeps the interaction and the tests
   simple and unambiguous.
2. **Scoring `n × (n − 1)`** rather than the classic `(n − 2)²` — the latter
   scores 0 for a pair, which feels punishing. `n × (n − 1)` is monotonic,
   intuitive, and still quadratic.
3. **4 colours on a 14 × 10 board.** Fewer colours make large groups easier to
   build (more satisfying) while the board stays big enough for interesting
   ordering decisions.
4. **Columns collapse to the left** (the most common convention) after gravity.
5. **No timer and no pause** — SameGame is turn-based with no real-time element,
   so a pause state would be meaningless.
6. **Folder is `SameGame/`** (PascalCase) to match the repo's existing folders;
   the git branch is `same-game` (kebab-case) per the task brief.
