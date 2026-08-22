# Lode Runner — Design

## Concept

A grid platformer about greed and timing. The runner must collect every piece of
gold on a level while guards hunt them across brick platforms, ladders and
ropes. The runner cannot jump and cannot fight: their only offensive move is
burning a hole in the brick beside their feet. A guard that drops into the hole
is stuck for a couple of seconds — long enough to run over their head — and if
the brick reseals while they are still down there, the guard is crushed and
reappears at their post. The same brick will crush the runner, so digging is as
dangerous as it is useful.

When the last coin is taken a hidden escape ladder appears at the edge of the
level; climbing off the top of the screen finishes the level.

## Board

A fixed 28 x 16 grid of 24 px tiles (672 x 384 canvas). Six tile kinds:

| Tile | Char | Behaviour |
|---|---|---|
| Empty | `.` | air — fall through it |
| Brick | `#` | blocks movement, can be dug |
| Stone | `@` | blocks movement, cannot be dug |
| Ladder | `H` | climbable, and holds an actor up |
| Rope | `-` | hangs an actor at head height; they can traverse it or drop off |
| Escape | `S` | plain air until the last coin is taken, then a ladder to the top |

`$` marks gold, `P` the runner's spawn, `E` a guard's spawn. Each level is
written as sixteen 28-character strings, which keeps the level data readable in
the source and trivially checkable in tests.

## Mechanics

**Movement.** Actors live on the grid: a move records its start cell, target
cell and a `0..1` progress value that advances at a cells-per-second speed. All
speeds are chosen so a move lasts a whole number of 1/60 s frames — walking 10,
climbing 12, falling 6, guards 15 — which makes `step(dt)` exactly reproducible
in tests. The runner may reverse mid-stride, but never mid-fall.

**Support.** An actor stays where they are if their own cell is a ladder or a
rope, if the cell below is brick, stone or a ladder, or if a trapped guard is
standing in it (you can sprint across a trapped guard's shoulders). Otherwise
they fall. Climbing up requires a ladder in both the current cell and the one
above, which is what stops the runner from climbing off the top of a ladder into
thin air.

**Digging.** `Z` burns the brick down-left, `X` the brick down-right. The dig
fails unless the runner is standing on something solid (not on a ladder or a
rope) and the cell being aimed through is clear. A dig asked for mid-stride is
held for a third of a second and fires the instant the runner reaches the next
cell, so digging on the run never feels like it was swallowed. A hole stays open
for five seconds — the last 1.5 s flash as a warning — then reseals into brick.
Anything standing in the cell at that moment dies: a guard is worth 75 points
and returns to its spawn, the runner loses a life.

**Guards.** Each guard runs a breadth-first search across the cells it may
legally enter (recomputed five times a second) and walks the first step of the
path. The search deliberately treats open holes as impassable, so guards never
walk into a pit on purpose — they only fall in when the floor is burnt out from
under them. With no route at all, a guard shuffles toward the runner's column so
it keeps pressing rather than freezing. A guard that lands in a hole is trapped
for 2.5 s and then scrambles out diagonally, preferring the side the runner is
on. Guards move slower than the runner (4 cells/s against 6), which is the whole
margin the game gives you.

**Scoring.** Gold 150, crushed guard 75, level cleared 500. Three lives; a death
resets every actor to its spawn and reseals open holes but keeps the gold
already banked. The best score is kept in `localStorage`.

## Controls

| Key | Action |
|---|---|
| `←` `→` / `A` `D` | run, and traverse a rope |
| `↑` `↓` / `W` `S` | climb a ladder; `↓` also drops off a rope |
| `Z` or `,` | dig down-left |
| `X` or `.` | dig down-right |
| `P` | pause / resume |
| `Space` | start, and continue to the next level |

## Code layout

- `index.html` — HUD, canvas and overlay markup.
- `style.css` — the repo's usual panel/HUD/overlay styling in a cool blue key.
- `game.js` — one classic (non-module) script, so its state and helpers are
  reachable from the Playwright specs as plain globals, in the same style as
  BurgerTime, Snake and Tetris in this repo. Sections in order: constants, level
  data, state, grid helpers, actors, level loading, gold, the runner, holes, the
  guards, collisions and level flow, `step(dt)`, HUD, rendering, input, the
  animation loop.

`step(dt)` is the whole simulation; `draw()` never mutates state. The animation
loop only calls `step` when the `autoStep` flag is set, and the specs clear that
flag so they can drive the simulation one exact frame at a time instead of
racing `requestAnimationFrame`.

## Tests

`tests/loderunner.spec.js` (71 specs) was written before the implementation and
covers: the idle page, level-data integrity, walking, falling, ladders, ropes,
gold and the hidden exit, level flow, digging and resealing holes, guard
pursuit, trapping, crushing and collisions, pause, best score and rendering.

Three specs are worth calling out because they check the levels rather than the
code:

- *every coin and the exit are reachable from the spawn* floods each level using
  the runner's own movement rules, including the dig-and-drop that is the only
  way into a sealed pocket, so no level can ship unwinnable. It caught exactly
  that: the first draft of level 3 ran its hidden escape ladder up the middle of
  the board, and since a hidden ladder is just air, the shaft cut a gap in every
  platform that the runner fell into instead of crossing. The escape ladder now
  runs up the edge of the board on all three levels.
- *every level can be won by playing it* actually plays each level: it plans a
  route with the runner's movement rules, presses the keys the game itself
  reads, replans whenever a fall lands somewhere unexpected, digs its way into
  the sealed pocket on level 3, and finishes by climbing the escape ladder. It
  is the end-to-end proof that the whole loop — input, physics, gold, exit,
  level flow — hangs together.
- *a full level of play raises no page errors* runs the real animation loop for
  a second and a half with the guards live and asserts the console stayed clean.

## Assumptions

The task description left some things open; where it did, the simpler reading
won.

- **Branch name.** The instructions asked for a branch named after the game, but
  this session is also required to develop and push only on its designated
  branch `claude/loving-euler-yy05wj`. The designated branch wins; the game name
  lives in the folder, the commits and the PR title instead.
- **Three levels.** Enough to show the mechanics escalating (ropes, then a
  sealed pocket that must be dug into) without hand-authoring a full campaign.
  Clearing the last one wins the game rather than looping forever.
- **Guards do not carry gold.** In the original, guards pick coins up and drop
  them again. That is a second scheduling problem on top of the AI and it makes
  levels harder to prove winnable, so guards here ignore gold.
- **A death keeps collected gold.** The original resets the whole level. Keeping
  the gold is friendlier and makes the level's progress legible in the HUD.
- **One guard AI, no personalities.** The original gives guards different
  pursuit styles. A single breadth-first pursuit, recomputed a few times a
  second, is enough to make them dangerous without being unfair.
- **No level editor, no sound.** Neither was asked for, and the repo's other
  games have neither.
