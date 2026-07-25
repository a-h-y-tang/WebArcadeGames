# Blob Drop — Design

> Note on file naming: the repo convention (and the root README) is a lowercase
> `design.md` per game. This file is named `DESIGN.md` to match the project
> brief, and a lowercase `design.md` in the same folder points here. It covers
> every required section: concept, mechanics, controls, and assumptions.

## Game concept

**Blob Drop** is a falling-piece action-puzzle game in the lineage of *Puyo
Puyo*. Coloured **blobs** fall from the top of a narrow well in joined **pairs**.
You slide and rotate each pair and drop it onto the growing pile. Whenever
**four or more blobs of the same colour become connected** (orthogonally), they
pop and vanish. Blobs above a pop fall into the gap, which can trigger *more*
pops — a **chain reaction** that is where the big scores come from. The well
gradually fills; when a fresh pair has no room to appear, the game is over.

The core hook is distinct from the other stacking games in this repo: Tetris and
Columns clear full **lines**, and match-3 games clear **rows/columns of a run**,
whereas Blob Drop clears **connected blobs of one colour** via flood-fill and
rewards cascading chains.

## Mechanics

### The well

The playfield is a grid of `COLS × ROWS` cells (6 × 12). Each cell is empty (`0`)
or holds a blob of one of `COLORS` (4) colours (`1..4`). Row `0` is the top; row
`ROWS-1` is the floor. Gravity pulls blobs toward higher row indices.

### The falling pair

Each falling piece is a **pair**: a *pivot* blob and a *satellite* blob in an
adjacent cell. The pair is described by the pivot's `{r, c}`, an `orientation`
(`0 = satellite up, 1 = right, 2 = down, 3 = left`), and the two colours. Pairs
spawn near the top in the spawn column, satellite above the pivot.

- **Move**: shift the pair one column left/right if both target cells are in
  bounds and empty.
- **Rotate**: cycle the orientation clockwise / counter-clockwise. If the
  satellite's new cell is blocked (wall or blob), a simple **wall kick** nudges
  the pivot one column the other way; if that is also blocked the rotation is
  rejected.
- **Soft drop / gravity tick**: move the pair down one row. If it cannot move
  down, it **locks**.
- **Hard drop**: move the pair straight down until it cannot, then lock.

### Locking and resolution

When a pair locks, both blobs are written into the grid and the board is
**resolved** by a pure routine, `resolveBoard(grid)`:

1. **Settle** — every column's blobs fall to rest on the floor or the blob below
   (`settleGravity`), so a satellite left hanging over a gap drops in.
2. **Find groups** — flood-fill each colour; any connected group of size
   `≥ CLEAR_THRESHOLD` (4) is a match (`findGroups`).
3. If there are no matches, stop. Otherwise **clear** every matched cell, count
   this as one **chain step**, settle again, and repeat from step 2.

`resolveBoard` returns the final grid, the number of **chains**, and the total
blobs **cleared**. Because it is a pure function of its input grid — no reliance
on timers, rendering, or module state — the whole clearing engine is fully
deterministic and directly unit-testable.

### Scoring

Each resolution awards `cleared × 10 × chains`, so a two-step chain is worth far
more than clearing the same blobs in two separate drops. The score and the
longest chain of the last drop are shown in the HUD.

### Spawning and game over

After a lock resolves, the **next** pair is spawned into the spawn cells. If
either spawn cell is already occupied, no pair fits and the game ends.

### Determinism

Blob colours come from a **seeded** generator (`mulberry32`), so `newGame(seed)`
produces a repeatable sequence of pairs. Tests can also install an exact board
with `loadGrid` and drive an exact pair with `setCurrentPiece`, making every
assertion deterministic.

## Controls

| Input                     | Action                              |
|---------------------------|-------------------------------------|
| **← / →** or **A / D**    | Move the pair left / right          |
| **↑ / X** or **W**        | Rotate clockwise                    |
| **Z**                     | Rotate counter-clockwise            |
| **↓** or **S**            | Soft drop (one row)                 |
| **Space**                 | Hard drop (slam to the bottom)      |
| **P**                     | Pause / resume                      |
| **R**                     | Restart                             |

## Testable API (exposed on `window`)

- Pure engine: `settleGravity(grid)`, `findGroups(grid)`, `resolveBoard(grid)`.
- Lifecycle: `newGame(seed)`, `getState()`, `getGrid()`, `loadGrid(rows)`,
  `spawn()`, `isGameOver()`.
- Piece control: `moveLeft()`, `moveRight()`, `rotateCW()`, `rotateCCW()`,
  `softDrop()`, `hardDrop()`, `tick()`, `setCurrentPiece(spec)`.
- `setAutoFall(bool)` — pause the gravity timer for deterministic testing.

## Assumptions

These choices resolve ambiguities in the brief; per the instructions the simpler
interpretation was taken and recorded here.

1. **Single-player, endless survival.** There is no versus mode or "garbage"
   blobs sent to an opponent — just one well, played until it tops out. This
   keeps the scope focused and the logic self-contained.
2. **Fixed gravity speed.** The pair falls at a constant interval rather than
   accelerating with score/level. Difficulty comes from the filling well, not
   from ramping speed. (A level curve would be an easy future addition.)
3. **Clear threshold of 4 and 4 colours**, the classic *Puyo* values, chosen so
   chains are achievable but not trivial.
4. **Simple one-cell wall kick** on rotation rather than a full SRS-style kick
   table — enough to make rotation feel fair without added complexity.
5. **Pieces are always two blobs** (no single blobs or larger shapes) and only
   one pair is in play at a time, which keeps collision and locking trivial.
6. **Scoring is `cleared × 10 × chains`** — a deliberately simple formula that
   still rewards chains, rather than reproducing any specific commercial scoring
   table.
