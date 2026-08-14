# Lode Runner — Design

## Concept

A grid-based platform puzzler. The runner has no jump and no weapon; the only
tool is a laser drill that melts a single brick out of the floor to the left or
right. Every level is a lattice of brick floors, ladders and hand-over-hand
ropes holding a fixed number of gold chests. Collect all of them and the hidden
escape ladders materialise, letting the runner climb off the top of the screen
to the next level.

Guards patrol the same lattice and home in on the runner constantly. They cannot
be killed by force, only outwitted: dig a hole in their path, let one drop in,
then run over its head while it struggles. A hole seals itself after a few
seconds — anything still inside is crushed. The runner is just as vulnerable, so
digging under your own feet is a fine way to bury yourself.

## Mechanics

### The grid

The world is a `COLS × ROWS` tile grid (28 × 16 for the shipped levels, 24 px
per tile). Tile kinds:

| Tile | Map char | Behaviour |
|---|---|---|
| Empty | `.` | Free movement, nothing to stand on. |
| Brick | `#` | Solid, and the only tile that can be drilled. |
| Solid | `=` | Solid and drill-proof (bedrock, the level floor). |
| Ladder | `H` | Climbable in both directions, and stands on. |
| Rope | `-` | Hang and traverse hand-over-hand; you never fall while on one. |
| Escape ladder | `E` | Empty until every chest is taken, then a ladder. |
| Gold | `$` | Chest sitting on an empty tile; walking onto it collects it. |
| Runner spawn | `@` | Exactly one per level. |
| Guard spawn | `X` | Zero or more per level. |

### Movement model

Actors (runner and guards) live *on* cells, never between arbitrary pixels.
Each actor is `{ c, r, tc, tr, p }`: a home cell, a target cell and a progress
value `p ∈ [0, 1)` along the move. Decisions are only taken when an actor is
aligned (`p === 0`), which is what makes the simulation reproducible: after a
known number of `step(dt)` calls the actor is provably in a known cell. Leftover
time is carried across cell boundaries inside `step`, so 60 calls at `dt = 1/60`
always cover exactly one second of motion regardless of how the cells line up.

Rules, applied in this order every time an actor becomes aligned:

1. **Support.** An actor is supported when it stands on a ladder or rope tile,
   when the tile below is brick/solid/ladder, when a trapped guard fills the
   cell below, or when it is on the bottom row. Unsupported actors fall, and a
   falling actor accepts no steering — the classic "commit to your drop" rule.
2. **Climb.** Up is legal only from a ladder tile; down is legal into any
   enterable cell (climbing a ladder down, or deliberately dropping).
3. **Run.** Left/right into any enterable cell (anything but intact brick,
   bedrock or off-grid).

Speeds are expressed in cells per second: runner 6.0 running, 5.0 climbing,
10.0 falling; guards 4.2 and 9.0, which is slow enough to outrun in the open and
fast enough to punish a bad ladder choice.

### Drilling

`Z` drills down-left, `X` down-right. A drill succeeds only when the runner is
aligned, standing on genuinely solid footing (not a ladder, not a rope, not
mid-fall), the target tile is intact brick, the tile directly above it is clear,
and no actor is standing in that cell. The brick becomes a hole for
`HOLE_TIME` (5 s); when the timer expires the brick reforms and anything inside
the cell is crushed — a guard dies and respawns, the runner loses a life.

### Guards

Guards path with a breadth-first search over the *reverse* movement graph seeded
at the runner's cell, recomputed whenever the runner changes cells. Each guard
then takes whichever legal move lowers its distance-to-runner the most, with
gravity overriding the choice. This gives guards that reliably corner the runner
through ladders and ropes without the hand-tuned column/priority tables of the
1983 original (see Assumptions).

A guard that lands in a hole is trapped for `TRAP_TIME` (2.6 s), then climbs out
toward the runner's side. While trapped it is a platform: the runner can stand
and run across its head. Touching a guard in any other way costs a life and
resets the level layout.

### Scoring and flow

| Event | Points |
|---|---|
| Gold chest | 100 |
| Guard crushed in a hole | 75 |
| Level cleared | 500 |

Three lives. Losing one reloads the current level from its map (gold included);
losing the last one ends the run. Clearing the final level wins the game. The
best score is kept in `localStorage` under `loderunner.best`.

## Controls

| Input | Action |
|---|---|
| `←` `→` / `A` `D` | Run, or traverse a rope |
| `↑` `↓` / `W` `S` | Climb a ladder, drop from a rope |
| `Z` or `,` | Drill down-left |
| `X` or `.` | Drill down-right |
| `Space` | Start / restart |
| `P` | Pause |

## Code layout

- `index.html` — canvas, HUD and overlay markup.
- `style.css` — presentation only.
- `game.js` — a single classic (non-module) script so every piece of state is a
  plain global reachable from Playwright, matching Snake, Tetris and BurgerTime
  in this repo. Sections: constants → level maps → grid helpers → actor
  movement → drilling → guard AI → collisions → game flow → input → render.
- `tests/loderunner.spec.js` — the Playwright suite, written before the
  implementation.

### Test hooks

The suite drives the simulation rather than watching it, using these globals:

- `step(dt)` — advance the simulation one frame.
- `autoStep` — set to `false` to stop `requestAnimationFrame` from also
  stepping, so manual stepping is the only source of motion. The test-only
  `loadLevelFromStrings` sets it automatically.
- `loadLevelFromStrings(rows)` — build a grid from an array of map strings of
  equal length; resets actors, holes and gold but leaves score and lives alone.
- `setPlayerCell(c, r)` / `setGuardCell(i, c, r)` — teleport an actor to a cell
  so a rule can be tested in isolation.
- `input` — `{ left, right, up, down }`, the same object the key handlers write.
- `tileAt(c, r)`, `digLeft()`, `digRight()`, plus `player`, `guards`, `holes`,
  `gold`, `goldRemaining`, `state`, `score`, `lives`, `level`.

## Assumptions

These were resolved without asking, per the task's instruction to take the
simpler reading and record it:

1. **Branch.** The task asks for a branch named after the game
   (`lode-runner`), while the session's standing instruction pins all work to
   `claude/loving-euler-bvimw8` and forbids pushing elsewhere. The standing
   instruction wins; the game name lives in the folder, commits and PR title
   instead.
2. **Guard AI.** The original's guard behaviour is a documented set of
   per-column priority tables. A BFS chase is simpler, deterministic and plays
   convincingly, so that is what ships.
3. **Guards and gold.** In the original, guards pick up and drop chests. Skipped
   — chests only ever move from the grid to the runner's score.
4. **Drilling is instant.** No multi-frame drill animation that locks the
   runner in place; the hole appears on the frame the key is pressed, with a
   brief visual flash only.
5. **Death resets the whole level**, gold included, rather than resuming from a
   checkpoint.
6. **Level completion is immediate.** Touching the top row with the escape
   ladders revealed loads the next level on the same frame, with a short banner
   rather than a cut-scene.
7. **Three hand-authored levels** rather than a procedural generator, so the
   difficulty curve (teach ladders → teach ropes → teach digging under pressure)
   is deliberate and the tests have fixed geometry to assert against.
8. **Collision is a 0.65-cell box** around actor centres rather than pixel
   sprites, which keeps hit detection consistent with the cell-based movement.
