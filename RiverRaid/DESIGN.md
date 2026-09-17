# River Raid — Design

## Concept

A vertical-scrolling river flight. The jet holds a fixed row near the bottom of
the canvas while the world scrolls down past it, so "flying upstream" is really
the river sliding by. The river is carved procedurally: the banks meander,
sandbanks split the channel into two lanes, and every hundred rows a bridge
closes the water and has to be shot out of the way.

The tension is fuel. The tank drains the whole time and the only refills are the
depots floating in the river — which are also worth 80 points if you shoot them.
Every depot is a decision: take the points, or take the fuel.

## Mechanics

**The river.** The world is stored as horizontal slices (`rows`), one every 20
world pixels, each holding a left bank, a right bank, and an optional island.
A row at world y `wy` draws at screen y `CANVAS_H - (wy - scrollY)`. Rows are
carved lazily by `ensureRows()`, always a little beyond the top of the screen,
and never discarded, so the geometry behind the jet stays queryable.

The generator walks a target width and centre, easing the banks toward them by
at most `BANK_STEP` per row, then re-squares the result so the channel is never
narrower than `MIN_RIVER` or wider than `MAX_RIVER` even mid-transition. Twenty
five rows before a bridge it locks a straight `CHANNEL_W` channel around the
current centre — the centre does not move during the lock, so the bridge is
always reachable from wherever the player already is.

**Islands.** A sandbank can start on any wide row, runs for 12–25 rows and ends
early if the banks close in on it. `ISLAND_MARGIN` keeps at least 46px of water
on each side: the jet is 22px wide, so a lane has to be flyable, not a slot.

**Fuel.** The tank burns `FUEL_BURN` per second, scaled by throttle. Flying over
a depot refills at `REFUEL_RATE`; because the refill is per second of contact,
throttling down over a depot is how you fill the tank completely. A dry tank
costs a life. The spawner also guarantees a depot at least every
`DEPOT_MAX_GAP` rows, so an unlucky run of warships can never strand the player.

**Targets.** Ships, helicopters and enemy jets patrol sideways, each fenced to
the lane it spawned in so nothing ever drifts over land. Colliding with one
costs a life; shooting one scores 30/60/100. Bridges are solid: fly into one and
you lose a life, shoot one and you score 500 and open the next section.
Difficulty rises with the section number through patrol speed.

**Lives.** Three. A crash rewinds the river slightly, refills the tank, sweeps
the stretch immediately ahead and drops the jet back in the middle of the lane
with the most room ahead of it — `safeCenter()` intersects lanes over the next
260px rather than taking the widest lane right now, which is what stops a single
crash from becoming a death loop in the same spot.

## Controls

| Input | Action |
|---|---|
| `←` `→` / `A` `D` | steer across the river |
| `↑` / `W` | throttle up (faster, burns more fuel) |
| `↓` / `S` | throttle down (slower, longer refuelling passes) |
| `Space` | fire (also starts the game when idle or after game over) |
| `Enter` | start / restart |
| `P` | pause / resume |

## Code layout

`game.js` is a single classic (non-module) script, matching BurgerTime, Snake
and Tetris in this repo, so its state and helpers are reachable from Playwright
as plain globals. All motion is per second and applied through `step(dt)`, and
drawing is a pure function of state, so the tests can simulate frames without
depending on wall-clock timing.

Two test seams exist and stay true in normal play:

- `autoLoop = false` stops `requestAnimationFrame` from stepping (it keeps
  painting), handing the clock to the spec.
- `spawnEnabled = false` clears the random traffic so a spec sees only the
  targets it placed itself.

`startGame(seed)` takes an optional seed. A live game draws a fresh one, so the
river is different every flight; the tests pass `TERRAIN_SEED` to pin it. The
terrain and spawn streams are separate generators derived from that one seed, so
switching spawning off does not change the shape of the river.

## Testing

`tests/riverraid.spec.js` drives everything through the real page: HUD and
overlay, starting, steering, throttle, the gun and its cooldown, each target's
score, patrol fencing, fuel burn/refuel/dry-tank, bridges and sections,
crashing, respawning, lives, game over, best-score persistence, pausing, and the
terrain invariants. Three of the specs are fairness invariants that came out of
bugs found by flying the game headlessly rather than from reading the code:
every island lane fits the jet with room to spare, the lane the game steers the
player into stays open, and fuel depots never leave a gap longer than a tank.

## Assumptions

Where the brief was open, the simpler reading won:

1. **Branch name.** The task asked for a branch named after the game
   (`river-raid`), but this session is pinned to the branch
   `claude/compassionate-ramanujan-0yq2b3` and instructed never to push
   elsewhere. The session's branch won; the game name lives in the folder,
   commit message and PR title instead.
2. **Shots fly until they leave the screen.** They are not stopped by land, so
   you can shoot across a sandbank. Simpler to reason about, and kinder.
3. **Targets do not shoot back.** They are obstacles and points, not a duel.
4. **Bridges must be destroyed.** There is no flying around one; the straight
   channel before it is the warning that it is coming.
5. **Play is endless.** Sections count up instead of the game having an end,
   with difficulty scaling through patrol speed.
6. **Refuelling is by contact time**, not an instant top-up, which is what makes
   the throttle worth using.
7. **The jet's collision box is its centre row**, 22×26px, so the nose may
   visually overlap a bank without a crash. Forgiving on purpose.
8. **Score comes from targets and bridges only**, not from distance flown.
