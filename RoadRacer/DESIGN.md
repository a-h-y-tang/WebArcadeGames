# Road Racer — Design

## Concept

Road Racer is a top-down, single-screen arcade **driving / dodging** game. You
control a car speeding up a three-lane highway. Traffic streams toward you from
the top of the screen; steer left and right to weave between the other cars.
The longer you survive, the faster the road scrolls and the higher your score.
One collision ends the run.

It fills a genre gap in the collection — none of the existing games are driving
games — while reusing the repo's established shape: a fixed-timestep `step(dt)`
simulation, an `idle → running → paused → over` state machine, a start/pause/
game-over overlay, an on-canvas HUD, and a best score persisted to
`localStorage`.

## Mechanics

- **The road.** The canvas is 400×600. A grey road occupies the middle
  (`ROAD_LEFT`…`ROAD_RIGHT`) with green grass shoulders on either side. Dashed
  lane markers scroll downward to convey speed. The road is split into
  `LANE_COUNT` (3) equal lanes.
- **The player car** sits near the bottom of the screen at a fixed `y`. Holding
  a steering key gives it a horizontal velocity; its `x` is clamped so the car
  can never leave the road surface.
- **Traffic.** Enemy cars spawn just above the top edge, each assigned to a
  lane, and scroll downward. Their downward speed is a fraction of the world
  scroll speed, so the player overtakes them (they appear to drift down the
  screen). Spawn cadence is distance-based; lanes are chosen so that a wall of
  cars never fully blocks the road (at least one lane is always passable).
- **Scrolling & difficulty.** `distance` accumulates at the current scroll
  speed every step. Scroll speed rises with the score up to a cap, so the game
  gets progressively harder. `score = floor(distance / SCORE_UNIT)`.
- **Collision.** Player vs. enemy car overlap (axis-aligned bounding boxes,
  slightly inset for fairness) ends the game immediately.
- **Passing.** When an enemy scrolls off the bottom it is removed and counts as
  a car passed (`passedCount`), purely for flavour/stats.
- **Best score** is stored under the `localStorage` key `roadracer-best`.

### State machine

`idle` → (start) → `running` ↔ (P) `paused`, and `running` → (crash) → `over`
→ (start) → `running`. The overlay is visible in every state except `running`.

## Controls

| Input | Action |
|---|---|
| `←` / `A` | Steer left |
| `→` / `D` | Steer right |
| `Space` / any steer key / **Start** button | Start or restart |
| `P` | Pause / resume |

Arrow keys and Space have their default page-scrolling behaviour suppressed.

## Testing approach (TDD)

The simulation is deterministic and decoupled from wall-clock time: the render
loop measures a frame delta and calls `step(dtMs)`, but tests drive `step()`
directly with fixed deltas and manipulate the exposed globals (`player`,
`enemies`, `score`, `state`, `distance`) — mirroring the pattern used by the
other games (e.g. Doodle Jump). Collisions are resolved on every `step()` call
regardless of delta size. Spawning uses `Math.random` for lane variety, but no
test depends on it: tests that need specific traffic clear `enemies` and push
their own, so the suite is fully deterministic.

## Assumptions

- **Simpler steering model.** The car moves freely (pixel-smooth) within the
  road bounds rather than snapping to discrete lanes — it feels better and the
  clamp logic is trivial to test. Enemies still spawn on lane centres.
- **Auto-throttle.** The player does not control speed; the world accelerates
  automatically with score. This keeps the control scheme to two keys and the
  difficulty curve self-evident, matching the "one simple mechanic" feel of the
  other arcade titles here. (A brake/accelerate model was the more complex
  interpretation; per the task guidance the simpler one was chosen.)
- **Score is distance-based** (arcade "how far did you get"), not time-based, so
  it scales with the difficulty curve.
- **Single canvas, no build step**, consistent with every other game: open
  `index.html` directly.
- **No audio.** None of the sibling games ship sound; omitting it keeps the
  game dependency-free and the tests hermetic.
