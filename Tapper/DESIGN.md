# Tapper — Design

## Concept

Tapper is a lane-based arcade serving game. You are the bartender working four
counters at once. Thirsty customers push in from the far (left) end of each bar
and shuffle steadily toward you. Slide a full mug down a bar and the customer at
the front of that lane grabs it, staggers backwards while drinking, and then
shoves the empty mug back at you. Catch the empty; let it fly off the end of the
counter and it smashes.

Keep every bar clear and the wave ends. Let a customer reach your end of a bar,
send a mug down an empty lane, or miss a returning empty and you lose a life.

The tension is the split attention: mugs take time to travel, empties come back
on their own schedule, and you can only stand at one bar at a time.

## Layout

```
         BAR_LEFT                                   BAR_RIGHT
            |                                            |
 lane 0     |  <- customers walk right     mug ->        | [ bartender ]
 lane 1     |                                            |
 lane 2     |                                            |
 lane 3     |                                            |
```

- Canvas is 640 x 440, four horizontal bars at `LANE_Y = [72, 164, 256, 348]`.
- The playable span of each bar runs from `BAR_LEFT` (60) to `BAR_RIGHT` (580).
- The bartender stands to the right of `BAR_RIGHT` and occupies exactly one lane
  at a time (`bartender.lane`); the drawn y-position eases toward the target
  lane so the sprite slides rather than teleports, but all game logic uses the
  discrete lane index.

## Mechanics

### Customers

- Customers spawn at `BAR_LEFT` and advance right at `customerSpeed()`, which
  grows with the level and is capped below the mug speed so a served mug always
  catches up.
- Customers in the same lane queue: a customer never advances closer than
  `CUSTOMER_GAP` to the one ahead of it.
- A customer that reaches `DANGER_X` has reached the bartender — a life is lost.
- Catching a mug puts a customer into the `drinking` state for `DRINK_TIME`
  seconds, during which it slides *left* at `PUSH_SPEED`. So each mug buys back
  a fixed amount of bar. When the drink finishes the customer returns to
  `advancing` and slides an empty mug back toward the bartender.
- A customer pushed past `BAR_LEFT` while drinking leaves satisfied: that scores
  `SERVE_POINTS`, and (by the simplification below) leaves no empty mug behind.

### Mugs

- `serve()` puts a full mug at the bartender's end of the current lane moving
  left at `MUG_SPEED`. Serving has a short cooldown (`SERVE_COOLDOWN`) so a held
  key cannot flood a lane.
- Collision is swept, not proximity-based: a mug hits a customer on the frame it
  crosses `customer.x + HIT_DIST` from the right. That prevents tunnelling at
  high mug speeds, and it means the *rightmost* eligible customer is always the
  one served.
- Only `advancing` customers take a mug; a mug passes a customer who is already
  drinking and can serve someone further down the bar.
- A mug that reaches `BAR_LEFT` without being caught smashes on the floor and
  costs a life.

### Empty mugs

- When a customer finishes drinking it sends an empty mug back to the right at
  `EMPTY_SPEED`.
- If the empty reaches `CATCH_X` while the bartender is in that lane, it is
  caught for `CATCH_POINTS`. Otherwise it keeps going and shatters at
  `BAR_RIGHT`, costing a life.

### Waves and lives

- A wave has `waveSize(level)` customers; they arrive one at a time on random
  lanes at `spawnInterval()`, which shortens as levels go up.
- The wave is clear when nothing is left to spawn and no customers, mugs or
  empties remain. That scores `CLEAR_BONUS * level` and advances the level.
- Losing a life clears the bars completely (mugs, empties and customers). Any
  customers who were on screen are returned to the pending queue, so the wave
  still takes the same number of successful services to finish.
- The run starts with `START_LIVES` (3) lives. At zero lives the game ends and
  the best score is written to `localStorage` under `tapper-best`.

## Controls

| Input | Action |
|---|---|
| ↑ / W | Move up one bar |
| ↓ / S | Move down one bar |
| Space | Serve a mug down the current bar |
| Enter / Space | Start (from the title or game-over screen) |
| P | Pause / resume |

Clicking **Start Game** on the overlay does the same as Enter.

## Code structure

`game.js` is a single classic (non-module) script, matching the rest of the
repo: every piece of state is a plain global so the Playwright specs can read
and drive it directly from `page.evaluate`.

- All motion is expressed per second and applied by `step(dt)`. The
  `requestAnimationFrame` loop only computes `dt` and calls `step` then `draw`,
  so the tests can simulate exact frame counts without depending on wall-clock
  timing.
- `step()` is a no-op unless `state === 'running'`, which makes the idle, paused,
  dying and level-clear screens trivially stable.
- `spawnEnabled` can be switched off after `startGame()` so a spec can place
  customers by hand and run long simulations deterministically. The random lane
  choice is the only nondeterminism in the game, and disabling spawning removes
  it entirely.
- Drawing is pure: `draw()` reads state and never mutates it, so a spec can call
  it in any state to check that rendering does not throw.

Key globals for tests: `state`, `score`, `lives`, `level`, `best`, `bartender`,
`customers`, `mugs`, `empties`, `pendingCustomers`, `spawnEnabled`, plus the
functions `startGame()`, `step()`, `draw()`, `serve()`, `moveLane()`,
`togglePause()`, `spawnCustomer()`, `customerSpeed()`, `spawnInterval()`,
`waveSize()` and `clearWaveForTest()`.

## Assumptions

These were ambiguous in the brief; the simpler reading was taken each time and
recorded here.

1. **Branch name.** The task asked for a branch named after the game
   (`tapper`), but this session is configured to develop and push only on
   `claude/loving-euler-ezkrbx`. The session branch wins; no `tapper` branch is
   pushed.
2. **Design document name.** The repo README asks for a lowercase `design.md`,
   while the task asked for `DESIGN.md`. Every recent game in the repo uses
   `DESIGN.md`, so this one does too.
3. **A customer who exits while drinking leaves no empty mug.** Chasing an empty
   that spawns off the end of the bar would be unfair, so the departing customer
   simply takes the mug with them.
4. **Only one drinker per mug, and drinking customers are transparent to mugs.**
   A mug travelling down a lane ignores customers who are already drinking. This
   keeps a served mug from being "wasted" on someone who is already busy.
5. **Losing a life resets the bars rather than only the offending lane.** The
   customers on screen go back into the pending queue instead of being forgiven,
   so a death costs time but not wave progress.
6. **Bonus/tip pickups from the original arcade game are out of scope.** Scoring
   is services, caught empties and a per-wave clear bonus only.
7. **Lane movement is discrete.** A key press moves exactly one bar; there is no
   held-key auto-repeat. Drawing interpolates the sprite's y for smoothness, but
   the bartender is always logically in exactly one lane.
