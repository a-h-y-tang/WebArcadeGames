# Scramble — Design

## Concept

A side-scrolling cave flyer. The jet flies right through a winding cave that
never stops scrolling, and the fuel gauge never stops falling. The only way to
refuel is to blow open the fuel tanks parked on the cave floor — so every top-up
means diving at the ground you are trying not to hit. Rockets standing on the
floor launch as the jet closes in. Reach the end of the cave and the next one
opens: longer, faster and rougher.

The tension is the fuel/terrain trade-off. Flying safely up the middle of the
cave is easy and gets you about two-thirds of the way through a cave before the
tank runs dry; the fuel you need is always at the bottom, next to the rock.

## Mechanics

### The cave

The cave is an array of 16px-wide columns, each with a `ceil` (bottom edge of
the ceiling rock) and a `ground` (top edge of the floor rock). Terrain is a
random walk that re-aims at a new ceiling/floor target every 5–18 columns and
moves towards it at a capped rate per column, which gives sloped rock faces
rather than noise. Two invariants are enforced per column after rounding:

- every column leaves at least `MIN_GAP` (110px) of clearance, so no cave can
  ever be sealed shut;
- the first `OPENING_COLS` (18) columns are a calm mouth with at least
  `OPENING_GAP` (150px) of clearance, so the run never begins inside a wall.

Roughness scales with the level (`0.3 + 0.1 × (level - 1)`, capped at 1), which
is what turns the clearance clamp from unused insurance at level 1 into the
binding constraint by level 6 — later caves are genuinely tight.

Everything about a cave — terrain, target placement, starfield — is generated
from a seeded PRNG (`mulberry32`) keyed off the level number, so a level looks
identical whether it is being flown for the first time or restarted after a
crash.

### Flying

The world scrolls at `78 + 12 × (level - 1)` px/s, capped at 170. The ship's
world x advances at the scroll speed, so it holds its screen position when no
key is held; ←/→ trim that by ±110 px/s within a screen-x band of 40–420. ↑/↓
climb and dive at 150 px/s. Touching either rock face is fatal — the ship's
32×14 box is tested against every column it overlaps.

### Weapons

- **Laser** (Space): flat, 430 px/s, max 4 in the air, spent on the first thing
  it hits — target, rock face, or the right edge of the screen.
- **Bomb** (B): released with a forward push of 0.7× scroll speed and a downward
  push of 40 px/s under 300 px/s² gravity, so it arcs ahead of the ship. Bursts
  on the cave floor.

Both destroy either target type. Bombs are the practical way to hit something
directly below; the laser is for rockets already climbing at you.

### Targets and fuel

Fuel tanks and rockets are parked on the floor at seeded intervals of 9–17
columns, starting 40 columns in (nothing lurks in the opening stretch), with a
45/55 split in favour of tanks. A tank pays 150 points and 25 fuel; a rocket
pays 80. A rocket launches once the jet is within `LAUNCH_RANGE` (260px),
climbing at 90 px/s while leaning 26 px/s towards the ship, and dies if it
reaches the ceiling.

Fuel burns at 3.0/s from a tank of 100 — about 33 seconds, against a level 1
cave that takes about 33 seconds to fly. Level 1 is therefore just barely
survivable without refuelling; every later cave is longer relative to its speed
and must be refuelled.

Destroyed targets are kept in their arrays until they scroll off the back of the
cave rather than being removed on death, so a wreck cannot vanish mid-explosion.

### Run structure

Three lives. A crash (rock, rocket or dry tank) costs a life, plays a 1.4s
explosion pause, then restarts the *current* level from its start with a full
tank — the score carries over, the cave does not. Reaching the end of the cave
pays `500 + 5 × remaining fuel`, pauses 1.6s, and opens the next level. Best
score persists in `localStorage` under `scramble-best`.

## Controls

| Key | Action |
|---|---|
| ↑ / W | Climb |
| ↓ / S | Dive |
| ← / A | Hold back |
| → / D | Speed up |
| Space | Fire laser (also starts a run) |
| B | Drop bomb |
| P | Pause / resume |
| Enter | Start / resume |

## Code shape

`game.js` is a single classic (non-module) script, matching BurgerTime, Kaboom!
and Snake in this repo: state and helpers are plain globals, which is what lets
the Playwright specs drive the simulation directly. All motion is expressed per
second and advanced through `step(dt)`, so tests simulate exact frame counts
instead of racing `requestAnimationFrame`.

Layers:

- **Generation** — `buildTerrain`, `buildTargets`, `buildStars`, `buildLevel`
- **Simulation** — `step`, `updateRun`, `updateBlasts`, plus `fire`, `dropBomb`,
  `resolveHit`, `crash`, `clearLevel`
- **Rendering** — `draw` and its per-layer helpers, called only from the rAF loop
- **Shell** — HUD, overlay, key handling

`flattenTerrain()` is a deliberate test hook: it irons the cave flat so a spec
about (say) bomb arcs is not really a spec about whichever rock face happened to
be under the ship. The generator is otherwise untouched by test concerns.

## Testing

`tests/scramble.spec.js` — 78 Playwright specs written before the
implementation, covering idle state, terrain invariants across levels 1–8,
determinism, flying and clamping, both weapons, fuel economy, target behaviour,
crashes, level progression, pausing, scoring and rendering.

Two habits keep them honest:

- `advanceUntil(page, expr)` steps one frame at a time until a condition holds,
  so timed transitions (crash pause, clear pause) are asserted at the instant
  they land rather than after a fixed frame count that the live rAF loop could
  overshoot.
- Assertions compare against constants declared in the spec, not values read
  back out of the game, so a spec fails if the game's constants drift.

## Assumptions

Made autonomously while building this, per the task's instruction to pick the
simpler reading and note it:

1. **Branch name.** The task asked for a branch named after the game
   (`scramble`), but the session's standing instruction is to develop and push
   only on the designated branch `claude/loving-euler-mgkopq`. The designated
   branch wins; no `scramble` branch was created.
2. **Two fire buttons.** The arcade original fires a laser and drops a bomb from
   one button. Here they are split (Space / B) because a single key that does
   both wastes bombs and makes the bomb arc hard to learn.
3. **Restart point.** The original restarts from a checkpoint within the level.
   This restarts the whole level, which is simpler and — since levels are only
   30–45 seconds — not punishing.
4. **Endless levels.** There is no final base to bomb and no win screen; levels
   keep getting longer, faster and rougher, and the run ends when the lives do.
   Scroll speed caps at 170 px/s so late levels stay flyable.
5. **Refuelling requires a hit.** Flying over a fuel tank does nothing; it must
   be destroyed. That is what makes the fuel/terrain trade-off the core tension.
6. **Screen size.** Fixed 640×400 canvas, matching the fixed-canvas convention
   of the other games in this repo rather than scaling to the viewport.
