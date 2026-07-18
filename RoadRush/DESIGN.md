# Road Rush — Design

## Concept

Road Rush is a top-down endless highway dodger. You drive a car up a
four-lane road while oncoming traffic streams toward you. Hop between lanes to
thread the gaps; a single collision ends the run. The longer you survive the
faster the road scrolls, so the difficulty ramps continuously. Score is the
distance travelled.

This is the first driving/racing game in the repo — every other game is a
shooter, puzzle, platformer, or paddle game — so it fills an empty genre.

## Mechanics

- **Lane hopping.** The player car sits near the bottom of the road and snaps
  between four discrete lanes. Each left/right press moves one lane and is
  clamped at the road edges — you can't drive onto the shoulder.
- **Oncoming traffic.** Enemy cars appear at the top in random lanes and move
  down the screen at the current road speed. A spawn cadence tied to distance
  keeps a steady but survivable stream, and the spawner never fills every lane
  at once, so there is always a gap.
- **Collision ends the run.** If the player's rectangle overlaps any traffic
  car's rectangle, the game is over. Best distance is saved in `localStorage`.
- **Speed ramp.** Road speed starts at a base value and grows with distance
  travelled, up to a cap. Faster road = faster traffic = higher score rate.
- **Scrolling road.** Dashed lane markings scroll downward to sell the sense of
  motion; they are purely cosmetic.

## Physics / update model

A single pure function `step(dt)` advances the simulation. `dt` is milliseconds
since the previous step, normalized to 60 FPS frames (`f = dt / 16.67`) so
behavior is frame-rate independent:

1. Recompute `speed` from distance travelled (base + ramp, capped).
2. Add `speed * f` to `traveled`; `score` is `floor(traveled)`.
3. Move every traffic car down by `speed * f`. Cars that pass the bottom edge
   are removed and `carsDodged` is incremented.
4. Advance the spawn accumulator; when it crosses the interval, spawn one car in
   a random lane that isn't the same as the most recent spawn (keeps a gap).
5. Scroll the dashed lane markings.
6. If the player's rectangle overlaps any car's rectangle, end the game.

The game loop uses a fixed-timestep accumulator over `requestAnimationFrame`:
real elapsed time is consumed in fixed `STEP_MS` chunks, so the number of
physics steps over a wall-clock interval is deterministic regardless of frame
rate.

## Controls

- **Left:** ArrowLeft or `A`
- **Right:** ArrowRight or `D`
- **Start / Restart:** ArrowLeft/Right, `A`/`D`, Space, or the on-screen button
- **Pause / Resume:** `P`

## Testing hooks

Following the repo convention, game state is exposed as module-level globals so
Playwright can read and manipulate it via `page.evaluate`: `player`, `cars`,
`state`, `score`, `best`, `speed`, `carsDodged`, the constants (`W`, `H`,
`NUM_LANES`, `LANE_W`, `CAR_W`, `CAR_H`, `START_LANE`), and the functions
`startGame`, `endGame`, `step`, and `laneX`. Because the loop is skipped while
`state !== 'running'`, tests pause the game and call `step(dt)` directly to
exercise physics (movement, collision, scoring) deterministically.

## Assumptions

- **Simpler-interpretation choices** (per the task's guidance to prefer the
  simpler reading and keep going):
  - Discrete four-lane snapping rather than free-analog steering — cleaner to
    play and to test, and true to the classic lane-dodger.
  - One life, no shields/power-ups/fuel — a single collision ends the run.
  - Score is integer distance rather than a themed points system.
- Canvas is a fixed 400×600 and does not resize responsively; the surrounding
  page is centered like the other games in the repo.
- `Math.random` chooses spawn lanes. Tests never depend on exact random spawns —
  they manipulate state directly or assert monotonic behavior, mirroring how the
  existing suites handle randomness.
