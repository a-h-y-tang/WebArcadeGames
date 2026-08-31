# Lode Runner — Design

## Concept

A dig-and-run maze platformer. The runner has to collect every piece of gold on
a level while guards hunt it across brick girders, ladders and ropes. It cannot
jump and it cannot fight: its only tool is a drill that melts a hole in the
brick to its lower left or lower right. Guards fall into the holes, the brick
grows back a few seconds later, and anything still standing in a hole when it
does is buried. When the last coin is taken a hidden escape ladder appears at
the top of the screen — climb it and the level is done.

## Mechanics

### The world

The level is a fixed grid, 28 columns by 16 rows of 24-pixel tiles (a 672x384
canvas). Six tile characters make up a map:

| Char | Tile | Behaviour |
|---|---|---|
| `.` | air | passable, nothing to stand on |
| `#` | brick | solid, and the only thing that can be dug |
| `=` | stone | solid and undiggable |
| `H` | ladder | climbable, and you can stand on it |
| `-` | rope | hang from it and move hand over hand |
| `S` | escape ladder | invisible air until the last coin is taken, then a ladder |

Maps additionally carry `$` (gold), `R` (the runner's start) and `G` (a guard's
start); those cells become air when the level is parsed and the entities are
put into their own lists.

Floors sit four rows apart, and every ladder ends on the surface it serves.
That single convention makes "you cannot climb off the top of a ladder into
thin air" a plain rule — a climb needs a ladder both under your feet and above
your head — instead of a special case.

### Moving

Actors are always in exactly one cell. A move commits its destination cell
immediately and keeps a small interpolation record used only for drawing, so
every rule in the game is exact integer arithmetic on cells while the picture
still slides smoothly between them. One cell of running or climbing takes
0.12 s, a cell of falling 0.08 s, and guards move at 0.18 s per cell — slower
than the runner, which is what makes escape possible.

An actor keeps its footing when it is on a ladder, hanging from a rope, or has
brick or stone directly beneath it. Anything else and it falls. A ladder
*below* is deliberately not support: you land on the ladder itself rather than
hovering above it. Falling stops as soon as a cell offers support again, so a
drop onto a rope catches you.

### Digging

`dig(dir)` drills the cell diagonally below the runner. It needs firm ground
underfoot (no digging in mid-air, on a ladder or from a rope), a brick — not
stone — as the target, and a clear cell above that brick so the hole can be
fallen into. A dig pressed mid-stride is remembered for a quarter of a second
and fires the moment the runner settles, which is how it feels to play; without
that buffer almost every dig during a run would be silently dropped.

The hole stays open for six seconds and flashes for the last second and a half
before the brick grows back. Whoever is standing in it then is killed: a guard
is worth 75 points and respawns at its start, the runner loses a life.

A hole is a scoop out of the brick rather than a shaft: a guard that drops in
lands in it, which is the trap the whole game turns on. The runner is nimbler
and slips straight through, so a dug hole doubles as a way down to the floor
below — and is only fatal where there is more solid ground under the hole, such
as the thick ledge on the right of level 1.

### Guards

Each guard picks its next cell with a breadth-first search across exactly the
moves an actor may make, and takes the first step of a shortest route to the
runner. Cells that hold an open hole are dead ends for the search, so a guard
never plans a route through a trap — it only falls in by walking over one. A
guard in a hole flounders for two seconds and then scrambles out diagonally,
preferring the side the runner is on.

### Scoring and progress

Gold is 100 points, burying a guard 75, and clearing a level 250. Three lives.
Being caught, or being buried, costs a life, refills every hole and returns the
runner and the guards to their starting cells; gold already collected stays
collected. When the three levels have been cleared the set repeats with the
guards moving 12% faster each time around.

## Controls

| Key | Action |
|---|---|
| Arrow keys / WASD | run and climb |
| `Z` or `,` | dig down-left |
| `X` or `.` | dig down-right |
| `P` | pause / resume |
| `Space` / `Enter` | start, or restart after game over |

## Code

Everything lives in one classic (non-module) script, `game.js`, so state and
helpers are reachable from the Playwright specs as plain globals — the same
shape as BurgerTime, Kaboom! and Snake elsewhere in this repo.

- `loadLevel(n)` parses a map into `grid`, `gold`, `guards` and the spawns.
- `step(dt)` is the whole simulation: digging, the runner, the guards, hole
  timers, collisions, and the state machine (`idle`, `running`, `dying`,
  `levelclear`, `paused`, `over`). Every timer is in seconds, so a test can
  simulate any amount of time exactly.
- `movesFrom(col, row, forGuard)` is the single definition of a legal move, used
  by the guards' pathfinder, by the specs' solvability check and by the
  autopilot that plays a level end to end in the test suite.
- `draw()` renders from the same state and never mutates it.

### Test hooks

Three globals exist for the specs: `autoStep = false` detaches the
requestAnimationFrame loop from the simulation so tests drive `step(dt)`
themselves and depend on no wall-clock timing; `guardsEnabled = false` freezes
the guards so movement specs stay deterministic; `guardsCanEscape = false`
holds a guard in its hole so the burial can be observed. All three default to
normal play.

## Assumptions

Decisions taken where the brief was open, with the simpler reading preferred:

- **Branch.** The task asked for a branch named after the game, but this
  session is pinned to the branch `claude/compassionate-ramanujan-smib98`, so
  the work was developed there rather than on a `lode-runner` branch.
- **Guards do not carry gold.** In the original a guard can pick a coin up and
  drop it later. That is left out: coins are only ever collected by the runner,
  which keeps "collect everything and the exit appears" honest.
- **Guard AI is a shortest-path chase**, not the original's column-scanning
  heuristic. It is simpler to state, deterministic, and quite hard enough with
  three of them on screen.
- **You cannot stand on a guard's head**, another flourish of the original that
  buys little and complicates the support rule.
- **Movement is grid-locked**, one cell at a time, with interpolation for
  drawing only. Sub-cell positions would make the digging and trapping rules
  much fuzzier for no gain in feel.
- **Death keeps the score.** A life lost resets positions and fills the holes
  back in but does not take back collected gold, so a hard level stays winnable.
- **Three hand-authored levels**, verified by a test to be finishable using only
  walking, climbing and falling — digging is a tactic against the guards, never
  a requirement. After level 3 the set repeats with faster guards rather than
  ending the game.
- **No sound**, matching the rest of the repo.
