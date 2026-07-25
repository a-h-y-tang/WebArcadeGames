# Pill Drop — Design

## Concept

Pill Drop is a falling-capsule colour-matching puzzle rendered on an HTML5
canvas. Coloured **viruses** sit at the bottom of a tall bottle. You drop
two-cell **capsules** (each half independently coloured) from the top and line
up **four or more** cells of the same colour in a row or column to clear them.
Clear every virus in the bottle to win the level; let the capsules pile up to
the top and you lose.

It belongs to the same family as Dr. Mario / Puyo but is an original
implementation with its own name, palette and (deliberately simplified)
physics. It is distinct from the repo's existing puzzles: unlike **Tetris** the
piece is always two cells and colour — not shape — drives clears; unlike
**Match-3** / **Columns** you place a falling piece rather than swapping a full
board, and the win condition is eliminating fixed virus targets.

## The board

- A bottle grid of **8 columns × 16 rows** (`COLS`, `ROWS`), each cell
  `30 px` → a `240 × 480` canvas.
- Three colours (`NUM_COLORS = 3`): red, blue, yellow.
- A run of **4 or more** (`MATCH_LEN`) same-colour cells horizontally or
  vertically clears. Both viruses and settled capsule halves count toward a run.

## The capsule

- Spawns horizontally at the top centre: pivot at row 0, column 3, second half
  to its right (columns 3 & 4).
- Orientation is one of four states; rotating clockwise cycles
  horizontal→vertical→horizontal→vertical, moving the second half around the
  pivot. A simple wall-kick nudges the pivot left when a rotation would push a
  half through the right wall.
- Falls one row per drop tick. When it cannot fall further it **locks** into the
  grid, then the board resolves.

## Resolving (clears, gravity, chains)

After a capsule locks:

1. Find every horizontal/vertical run ≥ `MATCH_LEN` and remove those cells,
   scoring viruses and capsule halves.
2. Apply gravity so unsupported capsule cells fall.
3. Repeat from step 1 — cascades score a rising combo multiplier.

Viruses never move; only capsule cells fall.

## Scoring & levels

- Capsule cell cleared: **10 pts**. Virus cleared: **100 pts**, multiplied by
  the cascade depth so chains are rewarded.
- Clearing all viruses awards a level-clear bonus and advances to the next
  level with more viruses. Best score is saved in `localStorage`.

## Controls

| Input | Action |
|-------|--------|
| ← / → or **A** / **D** | Move capsule left / right |
| ↑ / **W** or **X** | Rotate clockwise |
| **Z** | Rotate counter-clockwise |
| ↓ / **S** | Soft drop (fall faster) |
| **Space** | Hard drop (slam to the bottom) |
| **P** | Pause / resume |
| Space / **Start** button | Begin from the title screen |

## Assumptions & simplifications

These were chosen per the "pick the simpler interpretation" guidance; each is a
deliberate, documented simplification of the arcade original:

1. **Per-cell gravity.** After a clear, every unsupported capsule half falls
   straight down independently. The arcade original keeps some connected halves
   moving together; independent falling is simpler, fully deterministic, and
   still produces satisfying cascades.
2. **Three colours, fixed 8×16 bottle**, matching the classic proportions.
3. **Deterministic RNG.** Virus layout and capsule colours come from a seeded
   pseudo-random generator (`setSeed`) so a given seed always produces the same
   game — this also makes the Playwright suite reproducible. A default seed is
   used when the player just presses Start.
4. **Virus placement** avoids creating any run of 3+ same-colour cells at
   spawn, so no level begins with a "free" clear.
5. **Test hooks.** `loadGrid(rows)` installs an exact board from a character
   map and `autoDrop` disables the gravity timer, letting tests drive the core
   logic (`findMatches`, `applyGravity`, `resolveBoard`, `lockCapsule`)
   deterministically. These hooks do not change normal play.

## Code layout

- `index.html` — markup: HUD (score/best/level/viruses), canvas, title/end
  overlay, controls hint.
- `style.css` — layout and the bottle/overlay styling.
- `game.js` — all game logic and rendering. Top-level `let`/`const` bindings
  (`grid`, `state`, `score`, `level`, `capsule`, constants) and helper
  functions are exposed to the Playwright tests, matching the repo's other
  games.
- `tests/pilldrop.spec.js` — the Playwright suite (written first, TDD).
