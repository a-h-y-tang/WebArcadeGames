# Lode Runner — Design

## Concept

A dig-and-climb arcade platformer on a single HTML5 canvas. The runner is
dropped into a scaffold of brick floors, ladders and hand-over-hand ropes with
piles of gold scattered through it. Guards patrol the scaffold and hunt the
runner continuously. The runner cannot jump and cannot fight; the only weapon
is a shovel that blasts a hole in the brick floor beside them. Guards that
stumble into a hole are stuck until they climb out — and if the brick knits
itself back together first, the guard is crushed.

Collect every piece of gold and the escape ladders hidden in the level light
up, running all the way to the top of the screen. Reach the top row and the
level is done.

## Board

The level is a fixed `28 x 16` grid of 24 px tiles — a 672 x 384 canvas. Six
tile kinds:

| Tile | Char | Behaviour |
|---|---|---|
| Empty | `.` | Free space; you fall through it |
| Brick | `#` | Solid, and **diggable** |
| Solid | `=` | Solid bedrock; cannot be dug |
| Ladder | `H` | Climb up and down; supports anything standing on it |
| Rope | `-` | Hang and move hand-over-hand; press down to let go |
| Hidden ladder | `S` | Empty until all gold is collected, then a ladder |

Levels are authored as ASCII art in `game.js`. `P` marks the runner's start,
`G` a guard's start and `$` a piece of gold — all three sit on empty tiles.
Three levels ship with the game; after the third the game cycles back to the
first with faster guards, so a run is endless and the score is the objective.

## Mechanics

**Movement is grid-locked.** Every actor holds a floating-point tile position.
A move always runs from one whole cell to the next: while an actor is between
cells it keeps going on that axis, and support, blocking and turn decisions are
re-evaluated only when it lands exactly on the grid. That keeps physics
frame-rate independent and makes the simulation trivially reproducible in
tests, which drive it through `step(dt)` rather than the animation loop.

An actor is **supported** when it stands on a ladder, hangs on a rope, or the
tile below it is brick, bedrock or the top of a ladder. Unsupported actors
fall. Falling actors pass straight through ropes but stop on ladders.

**Digging.** `Z` digs down-left, `X` digs down-right. The target is the brick
diagonally below the runner; the dig is refused unless the runner is standing
on firm ground (not climbing, not hanging, not falling), the target really is
brick — bedrock never yields — and the tile directly above the target is
empty. The brick vanishes for `HOLE_TIME` (5 s), then grows back. Anything
standing in the cell when it grows back is destroyed: the runner loses a life,
a guard is crushed for 150 points and respawns.

**Holes and guards.** A guard that walks or falls into an open hole is trapped
there (75 points), drops any gold it was carrying onto the lip of the hole, and
climbs back out after 3 s. The runner is *not* held by a hole — they drop
straight through it, which is how you descend through a floor.

**Guard AI.** Every time a guard lands on a grid cell it runs a
breadth-first search over the movement graph — walk sideways where supported,
climb ladders, drop where the tile below is open — from its own cell to the
runner's, and takes the first step of the shortest path. The graph is directed
(a fall is one-way), so the search runs forward from the guard and the first
step is recovered from the parent chain. When no path exists the guard shuffles
toward the runner horizontally. Guards pick up gold they cross and hold one
piece until they are trapped, which is what forces you to hunt them down for
the last of the loot.

**Scoring.** Gold 250, trapping a guard 75, crushing a guard 150, clearing a
level 1500. The best score is kept in `localStorage`.

## Controls

| Key | Action |
|---|---|
| `←` `→` / `A` `D` | Run left / right |
| `↑` `↓` / `W` `S` | Climb a ladder, or drop off a rope |
| `Z` or `,` | Dig down-left |
| `X` or `.` | Dig down-right |
| `P` | Pause / resume |
| `Space` / `Enter` | Start, or restart after game over |

## Code layout

`game.js` is a single classic (non-module) script, matching the rest of the
repo, so the state and helpers are reachable from Playwright as plain globals:
`state`, `player`, `guards`, `grid`, `golds`, `holes`, `step(dt)`,
`startGame()`, `loadLevel(i)`, `tileAt(c, r)` and the tile constants. `step(dt)`
advances holes first, then the runner, then the guards, then collisions — so a
hole that refills on the same frame an actor is inside it kills that actor.
`guardsEnabled` switches guard behaviour off so physics tests stay
deterministic.

Rendering is plain 2D canvas: brick courses, ladder rails and rungs, rope
strands, spinning gold and two-tone stick figures. Nothing is loaded from disk,
so `index.html` opens straight from the filesystem.

## Assumptions

Decisions made without a human in the loop, each taking the simpler reading:

- **Branch name.** The task asked for a branch named after the game
  (`lode-runner`), but this session is pinned to the branch
  `claude/loving-euler-dyezpq` and must not push elsewhere. The pinned branch
  wins; the game folder carries the name instead.
- **Digging is instantaneous.** The original plays a short shovel animation
  before the brick clears. Here the brick clears on the same frame, which keeps
  the dig testable as a single state transition.
- **The runner falls through holes; only guards are held.** This matches the
  arcade original and makes digging the way to descend a floor.
- **A trapped guard is harmless.** Walking into a guard sitting in a hole does
  not kill the runner, rather than modelling standing on its head.
- **Guards do not collide with each other** and may share a cell.
- **One piece of gold per guard.** Gold is never destroyed: a trapped guard
  drops its piece on the lip of the hole, and a crushed guard's piece is
  returned to the board, so every level stays completable.
- **Death restarts the current level** with all gold restored, rather than
  preserving partial progress.
- **Levels cycle** after the third, with guard speed stepping up per level and
  capped, instead of ending the game with a "you win" screen.
- **Falling actors pass through ropes** but land on ladders.
