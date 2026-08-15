# Lode Runner — Design

How the code works, why it is shaped this way, and the calls that were made
where the brief left room for interpretation.

## Concept

A single-screen platform puzzler on a fixed tile grid. The runner has no
weapon: the only tool is a drill that opens a temporary hole in the brick
floor either side of them. Guards chase relentlessly, so the game is about
routing — deciding the order to sweep up the gold, and where to leave a hole
so the guard chasing you drops into it instead of onto you.

A level is finished when every gold bar has been collected — that reveals the
escape ladder — and the runner climbs to the top row of the screen.

## Mechanics

| Element | Behaviour |
|---|---|
| Brick `#` | Solid, and the only tile that can be drilled |
| Stone `@` | Solid and undrillable — the frame of every level |
| Ladder `H` | Climbable up and down; standing on the top tile is supported |
| Rope `-` | Hang and traverse sideways; press down to let go |
| Gold `$` | Collected by passing through the tile: +100 |
| Escape ladder `E` | Inert until the last bar is taken, then a working ladder |

- **Falling.** Anything not standing on a solid tile, a ladder (its own tile or
  the one below), a rope, or the head of a trapped guard falls. You cannot
  steer mid-fall — the commitment is what makes a dug hole dangerous to you as
  well as to the guards.
- **Digging.** `Z` / `X` drill the brick diagonally below-left / below-right.
  The drill needs firm ground under your feet and a clear tile above the
  target, so you cannot dig from a ladder, from a rope, or in mid-air.
- **Holes heal.** A hole fills back in after `HOLE_TIME` (5 s), and the last
  30% of that is drawn as the brick growing back. Anything still standing in
  the tile when it closes is crushed: a guard respawns at its start marker, the
  runner loses a life.
- **Trapped guards.** A guard that drops into a hole flounders for `TRAP_TIME`
  (2.5 s), then climbs out to whichever side is open, preferring the side the
  runner is on. While it is down there its head is solid ground — running
  across a trapped guard is a legitimate route.
- **Guard routing.** Each guard replans with a breadth-first search over the
  move graph (walk / climb / drop, no digging) whenever it lands on a tile, and
  takes the first step of the shortest route to the runner's tile. If no route
  exists it shuffles horizontally toward the runner instead, which is what
  keeps guards pressing you across a gap they cannot cross.
- **Scoring.** 100 per gold bar, 500 per level cleared. The best score of the
  session is kept in `localStorage` under `lode-runner-best`.
- **Lives.** Three. A death reloads the current level from scratch — gold,
  guards and holes all reset — but the score carries over.

## Controls

| Key | Action |
|---|---|
| ← / → or A / D | Run, climb sideways along a rope |
| ↑ / ↓ or W / S | Climb a ladder, drop off a rope |
| Z or `,` | Dig left |
| X or `.` | Dig right |
| Space | Start, or restart after a game over |
| P | Pause / resume |

## Code shape

`game.js` is one classic (non-module) script, matching the other games in this
repo, so every piece of state is a plain global the Playwright specs can read.

### Tile-locked motion

Entities are never at an arbitrary point on the map: they sit exactly on a
tile, or they are travelling in a straight line between two adjacent tiles.
Every decision — which way to run, whether gravity takes over — is made at the
moment an entity lands on a tile, by `decidePlayer` / `decideGuard`.

`advance(entity, dt, decide, onArrive)` slides an entity toward its target and,
when it lands, spends the *leftover* time on the next move. That has two
consequences worth keeping:

- `step(dt)` is exact for any `dt`. There is no per-frame rounding error to
  accumulate, so the tests can simulate a whole level deterministically.
- Tile coordinates are whole numbers between moves. This is load-bearing:
  every grid lookup indexes `grid[r][c]` directly, so an entity left at a
  fractional coordinate would read `undefined` and walk through the world. The
  "landed a hair short" branch in `advance` exists to guarantee it, and the
  regression it fixes was found by the route-finding bot in the test suite.

`step(dt)` slices time into 1/60 s sub-steps so collisions and hole timers are
sampled at a fixed rate no matter how the browser schedules frames.

### Level format

Each level is 18 rows of 28 characters using the legend above, plus `P` for the
runner's start and `G` for a guard. `loadLevelData` strips the spawn markers
out of the playable grid and turns them into entities, so the grid only ever
holds terrain. Sandbox levels built by the tests go through exactly the same
path, which is why a spec can exercise one mechanic on a bare floor.

### Rendering

`draw()` repaints from scratch each frame: gradient backdrop, terrain tile by
tile, hole refill progress, guards, then the runner on top. The hidden escape
ladder draws nothing until `exitRevealed`, at which point it comes back in a
different colour from the ordinary ladders so it reads as the way out.

## Testing

`tests/lode-runner.spec.js` drives the real page. Beyond the per-mechanic
specs, two tests are about the levels rather than the code:

- **Reachability.** For every level, a breadth-first search over the same moves
  a player has — including "drill the brick below and drop through it" — must
  reach every gold bar and the top row from the start marker.
- **Solvability.** A route-finding bot plays the actual game: it replans each
  frame, holds the same keys a player would, digs where the route calls for it,
  and has to reach the `won` state having cleared all three levels. It plays
  the full game in about a second of wall-clock time.

## Assumptions

The brief left these open; the simpler reading was taken each time and is
recorded here.

1. **Branch name.** The task asked for a branch named after the game
   (`lode-runner`), but this session's standing instruction is to develop and
   push only on `claude/loving-euler-h0zmyv`. The stricter instruction won, so
   the work lives on that branch.
2. **Three levels.** Enough to show progression and a win state without
   padding. `LEVELS` is a plain array — appending a fourth needs no code
   changes, only a layout that passes the reachability spec.
3. **Guards do not carry gold.** In the original arcade game guards can pick
   up a bar and drop it later. That is a second inventory to model and to
   render, and it can strand gold in unreachable places; guards here ignore it.
4. **Death reloads the whole level.** Gold already banked stays on the
   scoreboard, but the level resets. Tracking per-bar collection across lives
   would make the escape condition depend on history rather than the board.
5. **Guards cannot dig.** True to the original, and it keeps holes as a tool
   that belongs to the player alone.
6. **Input priority is up, down, left, right.** When two keys are held, the
   first legal move in that order wins, so a diagonal press at the foot of a
   ladder climbs rather than running past it.
7. **One shared hole timer.** Every hole heals after the same 5 s regardless of
   depth or what is standing in it.
8. **No level editor or high-score table.** Only the single best score is
   persisted, matching the other games in this repo.
