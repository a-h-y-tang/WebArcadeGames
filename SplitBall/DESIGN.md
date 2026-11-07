# Split Ball — Design

## Concept

Split Ball is a single-screen arena game about *taking space away from bouncing
balls*. The arena starts as one big open room with a few balls ricocheting
around it. You cannot shoot them, push them or touch them — all you can do is
grow walls.

Click anywhere in the open space and a wall sprouts from that cell, extending in
both directions at once until each end slams into something solid. The moment it
lands, the room is cut in two. Any sealed-off piece of the room that no longer
contains a ball collapses into solid matter and is yours.

A wall is only dangerous while it is growing. If a ball touches a half-built
wall, the whole thing shatters and costs you a life. So the game is a repeated
bet: look at where the balls are, guess where they will be a second from now,
and commit.

Fill 75% of the arena and the level is cleared. The next level hands you one
more ball and a little more speed.

This is the "JezzBall" family of games. It is deliberately *not* Xonix (already
in this repo): there you capture by drawing a trail with an avatar you steer,
here you have no avatar at all and capture by partitioning space.

## Board

The arena is a 30 × 20 grid of 24 px cells (720 × 480 canvas). The outermost
ring of cells is permanently solid, leaving a 28 × 18 = 504-cell interior — the
playfield that the fill percentage is measured against.

`grid[row][col]` holds one of three values:

| Value | Name | Meaning |
|---|---|---|
| `0` | open | balls may travel here, walls may be built here |
| `1` | solid | the border, finished walls, and captured territory |
| `2` | pending | part of the wall currently growing |

A parallel `captured[row][col]` flag records *why* a cell is solid. It has no
effect on the rules; it only lets the renderer tint captured territory
differently from the wall that earned it.

## Balls

A ball is `{ x, y, vx, vy }` in pixels, radius 7, moving at a constant speed
(`BALL_SPEED + 12 per level`) on a 45° diagonal. Each axis is integrated and
tested separately against the grid:

```
nx = x + vx * dt
if (overlapsSolid(nx, y)) vx = -vx    // reject the move, flip the axis
else                      x  = nx
```

Doing the two axes independently is what makes corner hits behave: a ball that
runs into the inside of a corner flips both components in the same frame and
leaves the way it came. Because the move is *rejected* rather than clamped, a
ball can never end a frame overlapping a solid cell, so it can never be trapped
inside the wall it just bounced off.

`overlapsSolid` tests the cells covered by the ball's bounding box, which is at
most 2 × 2 cells, so collision cost does not depend on arena size.

`dt` is clamped to 50 ms in the animation loop. At the fastest ball speed that
is well under one cell per frame, so tunnelling is impossible.

## Walls

Only one wall exists at a time. `buildWall(col, row)` succeeds when the game is
playing, no wall is active, and the target cell is open. It creates:

```
{ axis: 'v' | 'h', heads: [ {c, r, dc, dr, blocked}, ... ], cells: [...] }
```

The origin cell is marked pending immediately and the two heads crawl outward in
opposite directions — up/down for a vertical wall, left/right for a horizontal
one — at `GROW_SPEED` cells per second, driven by an accumulator so growth is
frame-rate independent. A head stops ("blocks") when the next cell is solid.

Each `step(dt)` runs the same phases, and the order matters:

0. **Age the flashes** left behind by shattered walls (see *Feedback*).
1. **Move the balls** against solid cells only — pending cells are not solid, a
   ball flies straight through a half-built wall.
2. **Grow the wall** by whatever whole cells the accumulator has earned.
3. **Check for a hit.** If any ball's bounding box overlaps any pending cell,
   the wall shatters: its cells go back to open, a life is lost, and (at zero
   lives) the game ends. Checking *after* growth is what makes a wall growing
   into a stationary ball lethal, not just a ball flying into a wall.
4. **Commit** — only if the wall survived step 3 and both heads are blocked.

## Capture

Committing turns every pending cell solid and then re-partitions the arena:

- Flood-fill (4-connected BFS) the open cells into regions.
- Mark a region *occupied* if any cell overlapped by any ball's bounding box
  belongs to it. Using the bounding box rather than just the centre means a ball
  straddling the new wall protects both regions it touches, so capture can never
  bury a ball.
- Every unoccupied region is filled: `grid = 1`, `captured = true`,
  `score += cells × CAPTURE_POINTS`.

Then the fill percentage is recomputed. At `FILL_TARGET` (75%) or more the level
is cleared.

With one wall at a time and only a few hundred cells, a full flood fill per
commit is a handful of microseconds — there is no reason to do anything cleverer
than the obvious BFS.

## Feedback

A shattered wall pushes `{ cells, life }` onto `effects`, and `step` counts
`life` down to zero over `FLASH_TIME` (0.5 s). The renderer draws those cells as
a red square that both fades and shrinks, so a wall that dies off-screen-centre
still tells you *where* it died. Effects are purely cosmetic — they hold no
grid state and are cleared with the level — but they are aged inside `step`
rather than from the clock so that a paused game is genuinely frozen and the
specs can assert on the fade.

## States

`idle → playing ⇄ paused`, plus `levelclear` and `over`.

| State | Enter | Leave |
|---|---|---|
| `idle` | page load | `startGame()` |
| `playing` | start / resume / next level | pause, level clear, game over |
| `paused` | `P` | `P`, Space, or the overlay button |
| `levelclear` | fill ≥ 75% | Space / button → `nextLevel()` |
| `over` | last life lost | Space / button → `startGame()` |

`step(dt)` is a no-op in every state but `playing`, which is what lets the specs
advance time by hand. The render loop only calls `step` when `autoStep` is true;
the Playwright suite switches it off and calls `step(dt)` itself, so every test
is deterministic and none of them sleep.

## Scoring

| Event | Points |
|---|---|
| Capturing a cell | 5 |
| Clearing a level | 250 × level |

The best score is persisted in `localStorage` under `splitball-best`.

## Controls

| Input | Action |
|---|---|
| Mouse move | aim — a dashed preview shows where the wall would go |
| Left click | build the wall |
| Right click / `X` | toggle vertical ⇄ horizontal |
| `←` `→` `↑` `↓` | move the aim cursor one cell (keyboard play) |
| `Space` | start / continue, and build the wall while playing |
| `P` | pause |

## Files

| File | Contents |
|---|---|
| `index.html` | HUD, canvas, overlay, help line |
| `style.css` | the shared arcade panel look used across this repo |
| `game.js` | the whole game: grid, balls, walls, capture, input, render |
| `tests/split-ball.spec.js` | the Playwright suite — 73 specs |

## Assumptions

These are the ambiguous calls, each resolved the simpler way:

1. **Branch name.** The task asks for a branch named after the game
   (`split-ball`), but this session is pinned to the designated branch
   `claude/compassionate-ramanujan-vwx5i5` and instructed never to push
   elsewhere. The designated branch wins; the game name lives in the folder,
   the commit and the PR title instead.
2. **One wall at a time.** The original arcade game allows a second wall while
   the first grows. One is simpler to reason about and to test, and it makes the
   "commit the bet" tension sharper.
3. **No level timer.** Scoring is capture-based only. A timer would add pressure
   but also a second failure mode to balance.
4. **A ball touching any pending cell destroys the wall**, rather than only the
   growing tip. Simpler rule, and it reads the same way to a player.
5. **Lives are not refilled** between levels, and territory already captured is
   kept when a wall shatters — losing a life costs you the wall, not the level.
6. **Balls always travel on a 45° diagonal.** Varying the angle would make the
   geometry prettier and the game less readable; the classic is diagonal-only.
7. **Fill target is a flat 75%** at every level. Difficulty ramps through ball
   count and speed instead, which is one dial rather than three.
8. **Touch is the click path.** Browsers synthesise a `click` from a tap, so
   the canvas click handler is all a phone needs; the CSS sets
   `touch-action: manipulation` to drop the 300 ms double-tap delay. There is
   no separate touch code to keep in step, and a spec runs in a touch-enabled
   context to keep it that way.
9. **Nothing is seeded.** Ball spawn positions use `Math.random()`. Every spec
   that needs determinism clears `balls` and places its own, so no seeded RNG is
   required.
