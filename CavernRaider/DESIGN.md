# Cavern Raider — Design

## Concept

Cavern Raider is a side-scrolling cave flight. You pilot a scout ship rightwards
through an endless winding cave that never stops moving past you. The rock
closes in from above and below and touching it wrecks the ship. Missile bases
stand on the cave floor and launch at you as you come into range, and your fuel
burns down the whole time — the only way to top it up is to blow up the fuel
tanks stashed along the floor, which means you have to shoot the very thing
keeping you alive.

That last tension is the heart of the game: pressing on is free, but you cannot
press on forever. Every fuel tank you skip is roughly ten seconds of flight you
will not get back, and the cave keeps getting tighter the deeper you go.

Inspired by Konami's 1981 *Scramble*.

## Mechanics

### The cave

- The cave is an ever-growing strip of `COL_W`-wide (12 px) **columns**, each
  holding a **mid-line** and a **gap height**. The ceiling is `centre - gap/2`
  and the floor is `centre + gap/2`.
- Both values change by a bounded amount per column: the mid-line wanders by up
  to `CENTRE_DRIFT` (2.2 px) and the gap by up to `GAP_DRIFT` (4.5 px). On top of
  the wander, the mid-line carries two sine waves — a long snaking sweep
  (`WAVE_LONG`) and a shorter ripple (`WAVE_SHORT`). Because every term has a
  bounded slope, the cave can pinch and snake but never *jump*, which is what
  keeps it flyable at any speed.
- A ragged lip of rock up to `RUBBLE` (7 px) bites into the gap from each side.
  It is **baked into the ceiling and floor values**, not drawn on top of them, so
  the jagged edge you see is exactly the edge that wrecks you. The gap is
  widened by the worst-case lip before it is clamped, so the clear channel is
  never tighter than `MIN_GAP` (130 px) however the rubble falls.
- The first `SAFE_COLS` (24) columns are held open to `SAFE_GAP` (200 px) so the
  run always starts in easy air, then ease naturally back down.
- **Depth squeezes the cave**: the widest gap allowed shrinks by `GAP_SQUEEZE`
  (22 px) per depth level. Depth is derived from the column index, never from
  the clock, so a column's shape never depends on *when* it happened to be built.
- Columns are generated lazily, memoised, and driven by a seeded PRNG
  (mulberry32). Each column's values come from a hash of `(seed, column,
  channel)`, so a given seed always yields exactly the same cave in exactly the
  same order. `setSeed(n)` pins the seed — the tests use it to get a
  reproducible cave; a real run reseeds randomly on every launch.

### The ship

- The ship flies in *screen* space (`ship.x`), pinned between `SHIP_MIN_X` and
  `SHIP_MAX_X`, while the cave flows past at `scrollSpeed()`. Its world position
  is `world.scrollX + ship.x`. Everything else — shots, bombs, missiles, tanks —
  lives in world space.
- Steering is direct velocity, not acceleration: hold a direction and the ship
  moves, release and it stops dead. Momentum on top of a closing cave read as
  unfair in play.
- The ship is wrecked by rock at any of **three probe points** across its hull
  (nose, middle, tail), so clipping a wall nose-first counts even while the tail
  is still in clear air.

### Weapons

- **Laser** (`Space`) fires a flat, fast shot forward, on an
  `BULLET_COOLDOWN` (0.18 s) cooldown. It is swallowed by rock and it dies at
  the right edge of the screen.
- **Bomb** (`X`) is lobbed forward with the ship's own speed and then falls under
  `BOMB_GRAVITY`, on a slower 0.45 s cooldown. It is the only way to reach a
  target tucked under a low roof that the laser cannot get level with.

### Targets and hazards

- **Fuel tanks** are worth `FUEL_POINTS` (30) and `FUEL_BONUS` (26) units of
  fuel, capped at a full tank.
- **Missile bases** are worth `ROCKET_POINTS` (50). One wakes up when the ship
  comes within `ROCKET_TRIGGER` (300 px) and is not already well past it, then
  climbs with a slight lean toward wherever you were when it fired, accelerating
  as it goes. It dies against the roof.
- Both are planted from a roll keyed off the column index, one roll every
  `SPAWN_EVERY` (4) columns, so the same seed always plants the same targets in
  the same places. Targets behind the screen are culled.

### The run

- You start with `START_LIVES` (3) ships and a full 100-unit tank that burns at
  `FUEL_BURN` (2.6/s) — about 38 seconds of flight.
- Touching rock, being hit by a missile, flying into a target, or running the
  tank dry all wreck the ship and cost a life. While the wreckage burns
  (`RESPAWN_DELAY`, 1.2 s) the cave holds still; the next ship then appears
  centred in the channel with a fresh tank, and any missile already in the air is
  cleared so it is not an unfair welcome.
- Losing the last ship ends the run. The best score is kept in `localStorage`
  under `cavern-raider-best`.
- **Score** is distance flown (one point per `DIST_PER_POINT`, 20 px) plus
  everything destroyed. **Depth** climbs every `LEVEL_DIST` (2400 px) and both
  speeds the cave up (`LEVEL_SPEED`) and narrows it (`GAP_SQUEEZE`), so a run
  ends when the cave finally out-paces you rather than at a fixed finish line.
- Speed **plateaus** at `MAX_SCROLL` (320 px/s, reached around depth 12). Left
  uncapped it reached 700+ px/s — past anything a human can fly, which turns the
  late game into a coin flip rather than a challenge. Past the cap the pressure
  comes from the still-narrowing channel instead.

## Controls

| Key | Action |
|---|---|
| ← / → / ↑ / ↓ (or A / D / W / S) | Fly |
| Space | Fire the laser (starts / restarts the run when idle or over) |
| X or B | Drop a bomb |
| P | Pause / resume |

## Code structure

Single classic (non-module) script, matching Slime Volley, Kaboom and Tetris in
this repo, so state and logic are reachable from the Playwright tests as plain
globals.

| File | Contents |
|---|---|
| `index.html` | Canvas, HUD (score, best, ships, depth, fuel gauge), overlay, help |
| `style.css` | Dark cave palette, HUD, fuel gauge, overlay |
| `game.js` | Cave generation, simulation, input, rendering |
| `tests/cavern-raider.spec.js` | 62 Playwright tests |

All motion is expressed per-second and advanced through `step(dt)`, which runs
fixed 1/240 s sub-steps. That keeps a fast laser from tunnelling through a wall,
makes the physics independent of frame rate, and — importantly — lets the tests
simulate any number of frames deterministically without waiting on
`requestAnimationFrame`. The real-time loop calls exactly the same `step()`.

## Testing

Written test-first: the spec was committed against an empty folder and the
implementation was written to turn it green. The suite covers cave generation
(determinism, bounded gaps, the safe launch stretch), ship control and clamping,
both weapons and their cooldowns, target destruction and refuelling, missile
launch triggering, fuel burn and starvation, all four ways to crash, respawn,
scoring, depth progression, best-score persistence, pause/restart and rendering.

Two tests deserve a note. The HUD tests sample the DOM **inside** the same
`page.evaluate` that drives the simulation, because the game's real animation
loop keeps running between an `evaluate` and a later DOM read and would move the
value out from under the assertion. And a `CENTRE()` helper is injected into the
page to park the ship in the middle of the channel each simulated frame, so a
test that is not about crashing never crashes by accident while the cave scrolls
underneath it.

```powershell
npx playwright test CavernRaider/tests/
```

## Assumptions

Decisions taken without asking, per the brief's "pick the simpler
interpretation" instruction:

- **Branch.** The task asked for a branch named after the game
  (`cavern-raider`), but this session's standing instructions pin all work to
  the designated branch `claude/compassionate-ramanujan-xfco4f` and forbid
  pushing elsewhere without permission. The designated branch wins; the game
  lives in `CavernRaider/` either way.
- **Endless, not levelled.** *Scramble* had a fixed six-section course ending in
  a base to bomb. An endless cave that tightens and speeds up with depth is
  simpler, has no "you win" edge case, and gives the score chase somewhere to
  go. Depth is the difficulty dial, not a stage list.
- **No forced-scroll death.** The ship is clamped to the screen rather than
  being shoved into the right edge by the scroll. Being killed by the frame edge
  reads as a bug to a modern player.
- **Direct velocity control** rather than thrust/inertia, as above.
- **Fuel tanks are shot, not flown through.** Matching *Scramble*; collecting
  them by touch would remove the reason to carry bombs.
- **A crash costs a life but not your progress.** The cave freezes and resumes
  where it stopped rather than restarting from a checkpoint, which keeps a run
  short and readable and avoids replaying cave you already flew.
- **Fixed 720×440 canvas**, like every other game in this repo — no responsive
  scaling.
- **Sound is out of scope**, consistent with the rest of the repo.
- **The game-browser e2e suite hardcodes a game count** (105) that was already
  stale against `games.json` (108) before this change, and is not run by the
  repo's root `npm test`. Adding Cavern Raider takes the catalogue to 109; those
  hardcoded counts were left alone as out of scope for this game.
