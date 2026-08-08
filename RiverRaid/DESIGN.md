# River Raid — Design

## Concept

A vertical-scrolling river shooter. You fly a jet up a winding river, shooting
helicopters, ships and enemy jets, flying over fuel depots to top up a tank that
drains continuously, and blowing up the bridge that closes each section of the
river. Crashing into a bank, a live enemy, a standing bridge, or running the tank
dry costs a jet; lose all three and the run ends.

The river is generated procedurally and never repeats, so the game is an endless
score chase divided into sections by bridges.

## Files

| File | Role |
|---|---|
| `index.html` | HUD, canvas, fuel bar, overlay, help legend |
| `style.css` | Dark arcade shell, overlay and fuel-gauge styling |
| `game.js` | All game state, simulation and rendering |
| `tests/river-raid.spec.js` | Playwright suite (69 tests) |

## World model

The jet is pinned to a fixed screen row (`PLAYER_Y`) and the world scrolls past
it. Everything in the world has a **world position** `worldY`, and `distance` is
how far the jet has flown. The jet's own world position *is* `distance`, so:

```
screenY = PLAYER_Y - (worldY - distance)
```

Objects with a larger `worldY` are further up the river (higher on screen) and
approach the jet as `distance` grows.

### Procedural river

The river is a list of **terrain rows**, each `ROW_H` (20) world units tall and
holding a `left`/`right` bank position. Rows are generated lazily by
`ensureTerrain(uptoWorldY)`, which keeps generating until the course covers a
target world position — the main loop asks for `distance + VIEW_AHEAD`, so
terrain always exists a screen-and-a-bit ahead of the jet.

`generateRow()` walks a cursor: it picks a random target width and left offset,
holds that target for 6–16 rows, and eases the current width/offset toward it by
a few pixels per row. That produces smooth meanders instead of jagged jumps.
Width is clamped to `[MIN_RIVER_W, MAX_RIVER_W]` and the banks are kept
`BANK_MARGIN` inside the canvas, so the river is always flyable. The first
`START_ROWS` rows are a straight, wide run-in so a new run never starts in a
bend.

`riverBoundsAt(worldY)` linearly interpolates between the two nearest row
centres, giving smoothly curving banks for both collision and rendering. Row
centres return their row's values exactly, which is what entity placement relies
on.

### Entities

One flat `entities` array holds everything in the river: `heli`, `ship`, `jet`,
`fuel` (depot) and `bridge`. Each has `{ type, x, worldY, w, h, vx }`.

- Traffic is spawned as rows are generated (~10–20% of rows, weighted by
  section), always positioned inside that row's banks, and never within two rows
  of a bridge so bridge runs stay clean.
- Helicopters, ships and enemy jets drift sideways at type-specific speeds and
  bounce off the banks at their own `worldY`.
- A **bridge** is spawned on every `SECTION_ROWS`-th row, spanning the full river
  width. It blocks the channel until it is shot.
- Anything more than `CULL_BEHIND` units behind the jet is dropped.

### Missiles

`fire()` launches a single missile from the jet's nose; a second shot is refused
while one is in flight, which is what makes aiming matter. A missile travels up
the river at `MISSILE_SPEED`, is spent on the first thing it hits, and is removed
if it leaves the top of the view or strays over a bank.

### Fuel

The tank drains at `FUEL_BURN` per second. Overlapping a depot refuels at
`REFUEL_RATE`; the burn is applied before the top-up so parking on a depot fills
the tank exactly to `MAX_FUEL`. Depots never damage the jet — they are shootable
for points *or* usable for fuel, and that trade-off is the core risk decision.
An empty tank costs a jet.

### Simulation order

`step(dt)` is the whole game, and it is deliberately pure over globals so tests
can drive it frame by frame:

1. clamp `dt` (a backgrounded tab must not teleport the jet through a bridge)
2. advance `distance` by `currentSpeed()`
3. move and clamp the jet sideways, decay invulnerability
4. `ensureTerrain` ahead
5. move entities, cull those left behind
6. move missiles, resolve missile hits, cull spent shots
7. resolve the jet: depots refuel, hazards and banks crash, then fuel burn
8. refresh the HUD

`currentSpeed()` = base speed + a per-section bonus, multiplied by the throttle
(fast / normal / slow), so later sections are genuinely harder at every throttle
setting.

### Crash and respawn

`crash()` clears missiles, decrements `lives`, and on the last jet ends the run.
Otherwise it refills the tank, re-centres the jet in the river at the current
distance, grants `INVULN_TIME` seconds of invulnerability (rendered as a flicker)
and clears non-bridge traffic within 160 units so the respawn is survivable.

### Scoring

| Target | Points |
|---|---|
| Ship | 30 |
| Helicopter | 60 |
| Fuel depot | 80 |
| Enemy jet | 100 |
| Bridge | 500 |

Destroying a bridge also advances the section counter. Best score is persisted to
`localStorage` under `riverraid-best`.

## Controls

| Input | Action |
|---|---|
| `←` / `→` (or `A` / `D`) | steer |
| `↑` / `↓` (or `W` / `S`) | throttle up / down |
| `Space` | fire (one missile at a time) |
| `Space` / `Enter` | start, or play again |
| `P` | pause / resume |

## Testing

Tests are Playwright specs that load `index.html` over `file://` and drive the
globals directly (`startGame()`, `step(dt)`, `spawnEntity()`, `fire()`,
`riverBoundsAt()`), which keeps them deterministic despite the procedural river:
instead of asserting on generated content, they assert on invariants (banks stay
in the canvas, width stays in range, entities spawn inside the river) and on
hand-placed entities. The suite was written before the implementation and covers
the river generator, flight and throttle, fuel, shooting, crashing, bridges and
sections, scoring/best, and pause/restart.

Run the suite with:

```powershell
npx playwright test RiverRaid/tests/
```

## Assumptions

These were decided without a human in the loop; the simpler reading was taken
each time.

1. **Branch name.** The task asked for a branch named after the game
   (`river-raid`), but this session is pinned to the designated development
   branch `claude/loving-euler-efwlqj`, and pushing elsewhere is not permitted.
   The work is therefore committed to the designated branch.
2. **No islands.** The arcade original grows islands in mid-river. This version
   models the river as a single channel with two banks, which keeps
   `riverBoundsAt()` a single interpolation and the collision rule trivial.
3. **Fuel depots are harmless.** In the original, touching a depot destroys the
   jet while flying over it refuels. Here overlapping a depot only refuels — the
   interesting decision (shoot it for 80 points, or save it for fuel) is
   preserved without a fiddly "over vs. into" distinction.
4. **Sections advance only by destroying a bridge.** Flying past a bridge is not
   possible while it stands, since it spans the channel. Only the bridge kill
   increments the section counter and its difficulty scaling.
5. **Scoring is kill-based.** No points are awarded for distance flown, so the
   score reflects what the player actually shot.
6. **One missile in flight**, as in the original, rather than a rapid-fire
   stream.
7. **Invulnerability after a respawn** (1.6s) can carry the jet through a
   standing bridge. That is accepted as the price of a survivable respawn rather
   than rewinding the jet to the start of the section.
8. **Canvas is a fixed 480×600** portrait board, matching the fixed-size,
   no-build convention of the other games in this repo.
