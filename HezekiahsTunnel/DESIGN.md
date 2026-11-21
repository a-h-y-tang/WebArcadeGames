# Hezekiah's Tunnel — design notes

*"...and how he made the pool and the tunnel and brought water into the city..."*
— 2 Kings 20:20

## Concept

King Hezekiah's workmen cut a channel through solid rock to carry the water of
the Gihon spring inside Jerusalem's walls, into the Pool of Siloam
(2 Kings 20:20; 2 Chronicles 32:30).

The player is the engineer. The spring is already running: a short grace period
is all the time there is before the water starts moving. Sections of hewn
channel arrive one at a time from the stonecutters, and each must be laid on the
bedrock grid so that the water, once it starts, runs from the spring all the way
to the pool without breaking out into the rock.

It is a pipe-laying race in the tradition of *Pipe Mania* — the queue of pieces
is random, so the route has to be improvised, and the water is always catching
up with the digging.

## Board

* The bedrock grid is 9 columns x 7 rows of 56px cells on a 560x420 canvas.
* Column 0 and column 8 are solid rock, except for the **spring** at
  `(springRow, 0)` and the **Pool of Siloam** at `(poolRow, 8)`.
* The playable area is columns 1-7. Each level scatters a number of **rock
  outcrops** there that cannot be dug.
* Level generation guarantees a clear route: a breadth-first search from the
  cell beside the spring to the cell beside the pool must succeed, otherwise the
  layout is thrown away and generated again. The two cells next to the spring
  and the pool are never blocked.

## Channel sections

Seven shapes, named by the sides they open onto:

| Type | Openings |
|---|---|
| `h` | west, east |
| `v` | north, south |
| `ne` | north, east |
| `nw` | north, west |
| `se` | south, east |
| `sw` | south, west |
| `cross` | all four |

`openings(type)` returns those sides; `exitDir(type, dir)` takes the direction
the water is *travelling* and returns the direction it leaves by, or `null` if
the section has no opening facing the water. A `cross` always passes the water
straight through, and it carries two independent channels — one horizontal, one
vertical — so a route may cross itself exactly once on each `cross`.

The next five sections are shown in a queue beside the board; `queue[0]` is the
one that will be laid next.

## Mechanics

* **Laying a section.** Click an empty playable cell (or move the cursor with
  the arrow keys and press Space). The head of the queue is laid there and a new
  random section joins the back of the queue. Rock, the spring, the pool and
  cells that already hold a section are refused.
* **The grace period.** Each level starts with a countdown (12s on level 1, down
  to 7s on level 5). When it reaches zero the spring starts to run.
* **The water.** A single head of water moves through the channels at the
  level's speed (0.7 cells/second on level 1, up to 1.4 on level 5), filling
  each cell as it goes. Every cell it completely fills scores 10.
* **A leak.** If the water arrives at bare ground, at rock, at the edge of the
  grid, at a section with no opening facing it, or at a channel that is already
  full, it breaks out into the rock. That costs one **day** of digging; the level
  is laid out afresh and tried again. Three days lost ends the game.
* **Clearing a level.** When the water enters the Pool of Siloam from the west
  the level is complete and scores a 200 bonus. There are five levels; clearing
  the fifth finishes the tunnel and wins the game.
* **Best score** is kept in `localStorage` under `hezekiahs-tunnel-best`.

## Controls

| Input | Action |
|---|---|
| Mouse click | Lay the next section on that cell |
| Arrow keys | Move the cursor |
| Space / Enter | Start, lay a section, or dismiss an overlay |
| P | Pause / resume |
| N | New game |

## Code structure

`game.js` is plain global-scope JavaScript (no modules), matching the rest of
the repository, so the Playwright tests can read and drive the game state
directly.

* **State.** `state` is one of `idle`, `running`, `paused`, `leak`,
  `levelclear`, `won`, `gameover`. Alongside it: `score`, `best`, `level`,
  `days`, `grace`, `grid`, `queue`, `cursor`, `flow`, `flooded`.
* **`grid[r][c]`** is `null` for bare ground or a cell object
  `{ kind: 'rock' | 'spring' | 'pool' | 'channel', type?, fill? }`. `fill` is a
  map from axis to progress 0..1; a normal section uses the single axis `main`,
  a `cross` uses `h` and `v`.
* **`flow`** is `null` or `{ r, c, dir }` — the cell the water is in and the
  direction it is travelling. Progress lives in that cell's `fill`.
* **`step(dt)`** advances the simulation by `dt` seconds: it burns down the
  grace period, then moves the water, filling cells and crossing into the next
  one through `enterCell(r, c, dir)`, which is also where leaks and the pool are
  detected. The real-time `requestAnimationFrame` loop calls the same `step`.
* **Rendering** is split into `draw()` for the board (rock, spring, pool,
  channels with their water, the cursor) and `drawQueue()` for the queue strip.

### Test hooks

The tests drive the game through the same entry points the UI uses, plus three
deliberate hooks:

* `stopLoop()` / `startLoop()` — stop and restart the animation frame loop so a
  test can advance time itself with `step(dt)` and get an exact result.
* `buildLevel({ level, springRow, poolRow, rocks })` — lay out a known board
  (used to build a route by hand instead of relying on a random layout).
* `enterCell(r, c, dir)` — send the water into one cell, so the leak rules can
  be checked one at a time.

## Assumptions

* **Branch name.** The task asked for a branch named after the game
  (`hezekiahs-tunnel`). This environment requires all work to be pushed to the
  session's assigned branch, `claude/compassionate-ramanujan-626znl`, so the work
  is committed there instead; the game folder carries the name.
* **No replacing a laid section.** The arcade original lets a player overwrite a
  section that the water has not reached yet, at a cost. The simpler reading is
  taken here: a laid section stays, and a cell that already holds one is refused.
  The pressure comes from the countdown instead.
* **No discarding the queue head.** The queue cannot be skipped; every section
  that arrives has to be laid somewhere.
* **A leak restarts the level rather than ending the game**, with three days to
  spend in all. This is friendlier than the original's single life, and keeps a
  bad queue from ending a run immediately.
* **One head of water.** A `cross` carries two separate channels, but the water
  never branches, so at most one head is in motion at any time. Each of a
  cross's two channels scores in its own right, so a route that crosses itself
  is paid for both passes.
* **Five levels.** Difficulty rises through five hand-tuned levels and the game
  is won at the end of the fifth, rather than continuing endlessly.
* **The route is not required to be long.** Score comes from cells flooded, so a
  winding route pays better than a short one, but a straight dash to the pool is
  a legal way to clear a level.
