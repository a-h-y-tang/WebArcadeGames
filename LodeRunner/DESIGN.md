# Lode Runner — Design

## Concept

Lode Runner is a grid platformer about theft and improvisation. The **runner**
drops into a brick vault patrolled by **guards**, has to collect every bar of
gold, and then climb out through escape ladders that only appear once the last
bar is in hand.

The runner cannot jump and cannot fight. The only offensive move is the **dig**:
blasting the brick immediately below-left or below-right, leaving a hole. A
guard that walks over a fresh hole falls in and is stuck for a few seconds — long
enough for the runner to sprint across its head. Holes grow back on their own, so
a guard that is still down there when the brick knits itself shut is buried and
respawns at its starting post. So is the runner, if they were careless enough to
be standing in their own hole.

Three levels ship with the game: *Warm-up*, *Crossings* and *The Vault*.

## Mechanics

### The world

The level is a character map — 30 columns × 18 rows for the built-in levels —
parsed into a tile grid:

| Char | Tile | Behaviour |
|---|---|---|
| ` ` | empty | passable, no support |
| `#` | brick | blocks movement, **can be dug** |
| `=` | stone | blocks movement, cannot be dug |
| `H` | ladder | climbable, supports the actor standing on it |
| `-` | bar | hang and move sideways, supports the actor, no climbing |
| `$` | gold | passable; collected on entry |
| `S` | hidden exit ladder | behaves as empty until the exit opens, then as a ladder |
| `P` | runner spawn | (tile underneath is empty) |
| `G` | guard spawn | (tile underneath is empty) |

`tileAt(c, r)` returns what the world *behaves* like right now — it is the same
as the raw map except that `S` reads as empty while gold is still out there. The
rest of the code never has to special-case the exit.

### Support and gravity

An actor stands still when `isSupported(c, r)` holds — that is, when it is on a
ladder or a bar, sitting in a dug hole, on the bottom row, on top of brick /
stone / ladder, or on the head of a trapped guard. Otherwise gravity takes over
and the actor falls one cell at a time. **There is no steering mid-fall**, which
is what makes a dug hole a commitment.

### Moving

Movement is cell-by-cell on a timer, one interval per cell:

| Interval | Seconds/cell |
|---|---|
| `MOVE_INTERVAL` (run) | 0.10 |
| `CLIMB_INTERVAL` (ladder) | 0.12 |
| `FALL_INTERVAL` | 0.07 |
| `GUARD_MOVE_INTERVAL` | 0.19 |
| `GUARD_FALL_INTERVAL` | 0.09 |

Vertical input wins over horizontal when both are pressed. Up only works on a
ladder; down works whenever the cell below is passable, so pressing down on a bar
lets go of it.

### Digging

`dig(dir)` removes the brick at `(c + dir, r + 1)` when all of the following
hold: the runner is supported and not falling, is not standing on a ladder or a
bar (no leverage), the target is plain brick (not stone), the cell beside the
runner is clear, and no guard is standing in the target. The hole is recorded in
`holes` with a timer and the tile becomes empty; after `HOLE_TIME` (5 s) the tile
becomes brick again, burying whoever is in it. The last ~1.2 s of a hole's life
flashes so the refill is never a surprise.

### Guards

Guards use a small deterministic chase heuristic, evaluated fresh on each of
their moves:

1. Climb toward the runner if standing on a ladder and the runner is above.
2. Drop toward the runner if the runner is below and the cell below can be
   entered from a ladder or bar.
3. Otherwise step horizontally toward the runner.
4. If that is blocked, try the other way, then down, then up — so a guard never
   locks up in a corner.

Guards never dig and never pick up gold. A guard that ends a move on a hole cell
is trapped (`TRAP_POINTS`); after `GUARD_TRAP_TIME` (3 s) it scrambles out
sideways-and-up, preferring the runner's side, onto any supported cell. Since
`GUARD_TRAP_TIME < HOLE_TIME`, a guard normally escapes — burying one takes a
hole that is already close to closing.

### Scoring, lives and progression

| Event | Points |
|---|---|
| Bar of gold | 100 |
| Guard trapped | 50 |
| Guard buried | 100 |
| Level cleared | 500 + 100 per remaining life |

The runner starts with 3 lives. Being touched by an untrapped guard, or being in
a hole when it refills, costs one: the holes fill in and every actor returns to
its spawn, but **the score and the gold already collected are kept**. At zero
lives the run ends and the best score is written to `localStorage` under
`lode-runner-best`. Clearing the last level wins the game.

## Controls

| Input | Action |
|---|---|
| ← / → or A / D | Run left / right |
| ↑ / ↓ or W / S | Climb a ladder, or drop off a bar |
| Z or `,` | Dig down-left |
| X or `.` | Dig down-right |
| Space | Start / restart |
| P or Esc | Pause / resume |

## Determinism & testing

Following the pattern used by the other games in this repo (Kaboom, Dino Run,
Tetris), the game is a single classic (non-module) script, so its state and
functions are reachable from Playwright as plain globals. Everything is advanced
through `step(dt)`, which is also what the `requestAnimationFrame` loop calls —
so the tests exercise the real simulation.

Two hooks exist purely for the tests:

- `setAutoStep(false)` stops the animation loop from advancing the simulation, so
  a test owns the clock completely and no wall-clock time leaks into a result.
- `loadLevelLines(lines)` loads an arbitrary character map (any width/height), so
  a test can build a six-row level that puts the runner exactly one cell from the
  situation under test instead of driving it across a full level.

There is no randomness in the simulation at all — particles are the only thing
that use `Math.random()`, and they are cosmetic. The guard AI is a pure function
of the board and the runner's position, so a trapped-guard test replays
identically every run.

Two tests are really level-data checks: one asserts every actor spawns on firm
footing, and one floods each level with the runner's own movement rules to prove
that every bar of gold can be reached from the spawn and that the top row is
climbable once the exit opens. Between them they make an unwinnable level a test
failure rather than a player's discovery.

## Assumptions

These choices were made where the brief was open-ended; the simpler option was
taken each time and recorded here:

- **Cell-by-cell movement, not pixel-smooth.** Actors occupy whole grid cells and
  step between them on a timer. The original scrolls actors smoothly between
  cells; discrete movement keeps collision, support and digging exact, and makes
  every rule testable as an integer fact.
- **A hole is a pit you stand in.** A dug cell supports whoever is in it, even
  when the space below is open air. Modelling the hole as a pit in the brick
  (rather than a doorway to the floor below) is the simpler reading and is what
  makes the "buried alive" rule meaningful.
- **No mid-air steering.** Falling actors cannot move sideways. The original is
  the same, and it is the simpler rule.
- **Guards do not carry gold.** In the original a guard can pick up a bar and
  drop it later; here gold only ever moves from the map to the runner. This
  removes a whole class of unwinnable states.
- **Guards climb out of holes on a fixed timer** (3 s) rather than the original's
  level-dependent schedule.
- **Death keeps your gold.** Losing a life resets positions and fills in holes but
  keeps the score and the gold already collected, so a death costs tempo rather
  than the whole level. The alternative — restarting the level outright — is
  harsher and needs a second copy of the level state.
- **Escape means reaching the top row**, anywhere along it, once every bar is
  collected. The built-in levels put hidden ladders down both side walls so the
  climb out is always available; the original hides ladders in level-specific
  places.
- **Three levels.** Enough to show the mechanics (ropes, stone that cannot be dug,
  multiple guards) without the game becoming a level pack.
- **Branch naming.** The task asked for a branch named after the game
  (`lode-runner`), but this session is required to develop and push on its
  assigned branch `claude/loving-euler-5bav55`. The assigned branch won; the game
  name lives in the folder, the commit and the PR title instead.
