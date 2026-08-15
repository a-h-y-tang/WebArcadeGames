# Scramble — Design

## Game concept

A horizontally auto-scrolling cave shooter on an HTML5 canvas. You fly a jet
across four terrain sections — rolling hills, jagged mountains, a stalactite
cave and a tunnel guarded by an enemy base. The world scrolls forward on its
own and never stops: you steer inside the visible window, shoot forward with a
laser and lob bombs at the ground.

Two resources run the game. **Fuel** drains continuously, so the fuel dumps on
the ground are not optional scenery — you have to bomb them to keep flying.
**Lives** are lost to the terrain itself, to the rockets that launch off the
ground as you approach, and to running dry.

Nothing else in this repo uses an auto-scrolling world with destructible ground
targets and a fuel economy; Moon Patrol scrolls but is a jump-and-shoot lane
game, and the other shooters are single-screen. This is a new shape of play for
the collection.

## World geometry

Everything derives from a column grid so the terrain is easy to reason about
and to assert on in tests.

| Constant | Value | Meaning |
|---|---|---|
| `CANVAS_W` × `CANVAS_H` | 640 × 420 px | the visible window |
| `COLUMN_W` | 16 px | one terrain column |
| `SECTION_COLUMNS` | 64 | columns per section (1024 px) |
| `SECTIONS` | 4 | sections per level |
| `LEVEL_COLUMNS` | 256 | columns in a level |
| `WORLD_W` | 4096 px | total level width |
| `MIN_GAP` | 120 px | narrowest flyable corridor the generator will emit |

The terrain is two arrays of column heights: `groundH[col]` measured up from
the bottom edge, and `ceilH[col]` measured down from the top edge. A column is
flyable between `ceilingYAt(x)` and `groundYAt(x)`, and the generator clamps
the ceiling so that gap is never smaller than `MIN_GAP`.

| Section | Ground band | Ceiling |
|---|---|---|
| 0 — hills | 40–90 px | none (open sky) |
| 1 — mountains | 50–130 px | none (open sky) |
| 2 — cave | 50–150 px | 30–110 px |
| 3 — tunnel | 60–120 px | 30–110 px, clearing over the base |

The first six columns are flat and open so a spawn or respawn is never
instantly fatal, and the last ten columns (the base zone) are flat with no
ceiling so the run-in to the finish is clean.

Terrain and object placement come from a seeded PRNG (`mulberry32`) keyed on the
level number, so level *N* is always the same level *N* — the game is
replayable and the tests are deterministic without any fixtures.

## Mechanics

**Scrolling.** `scrollX` advances at `scrollSpeed()` = `100 + 12 × (level − 1)`
px/s, capped at 190. The ship's world x advances with the scroll plus whatever
the player adds, and its *screen* x is clamped to 40–384 px, so you can push
forward for early shots or hang back for reaction time but never leave the
window. The level clears when `scrollX` reaches `WORLD_W − CANVAS_W`.

**Fuel.** Starts at 100 and drains at 4 units/s — about 25 seconds of flight
against a level that takes ~41 seconds at level 1 speed. Destroying a fuel dump
returns 18, capped at 100. Fuel hitting zero is a crash.

**Laser.** `Space` fires a forward bullet from the nose at 420 px/s (world
frame). Cooldown 0.18 s, at most 4 in flight. A bullet dies on terrain or on
the target it destroys.

**Bombs.** `B` drops a bomb that inherits the ship's forward speed and falls
under gravity (520 px/s²), so aiming means dropping *early*. Cooldown 0.3 s, at
most 3 in flight. A bomb explodes on the ground, on the ceiling or on a direct
hit, and its blast has a 34 px radius — one well-placed bomb can take out a
rocket standing next to a fuel dump.

**Targets.** Fuel dumps (100 pts + fuel) and rockets (50 pts by laser, 80 by
bomb — the bomb is worth more because it is harder to aim) sit on flattened
ground. Rockets launch straight up at `60 + 8 × level` px/s once the ship is
within 140 px, which is the game's core threat: they turn the ground into a
hazard you have to shoot *before* you arrive. The base at the end of the level
is worth 800.

**Crashing and checkpoints.** Touching terrain, touching any target, or running
out of fuel costs a life. After a 1.2 s pause the ship respawns at the start of
the *current section* — sections double as checkpoints — with full fuel, a
clear screen, every target from the checkpoint onward restored, and 1.5 s of
invulnerability. Out of lives ends the run and stores the best score in
`localStorage` under `scramble-best`.

**Levels.** Clearing a level awards `500 × level`, then rebuilds the world one
level up: faster scroll, faster rockets and denser rocket placement
(`max(6, 14 − level)` columns apart).

## Controls

| Input | Action |
|---|---|
| `←` `→` / `A` `D` | ease forward / hang back within the window |
| `↑` `↓` / `W` `S` | climb / dive |
| `Space` | fire laser (also starts the game when idle or after game over) |
| `B` | drop bomb |
| `Enter` | start / restart |
| `P` | pause / resume |

## Code structure

`Scramble/game.js` is a single classic (non-module) script, matching Kaboom!,
BurgerTime and Snake in this repo: every constant, piece of state and helper is
a plain global, which is what makes the Playwright specs able to reach in and
assert on the simulation.

- **Generation** — `mulberry32`, `buildLevel(level)`. Writes `groundH`,
  `ceilH`, `tanks`, `rockets`, `base`.
- **Terrain queries** — `colAt`, `groundYAt`, `ceilingYAt`, `corridorMidY`,
  `hitsTerrain`.
- **Simulation** — `step(dt)` advances scroll, fuel, ship, bullets, bombs,
  rockets, explosions and collisions, in that order. All motion is expressed
  per second, so tests call `step(1/60)` in a loop and get frame-exact results
  with no dependence on `requestAnimationFrame` wall-clock timing. `step` is a
  no-op unless the game is running (it only ticks timers while `dying` or
  `levelclear`).
- **Flow** — `startGame`, `crash`, `respawn`, `gameOver`, `levelClear`,
  `nextLevel`, `togglePause`.
- **Rendering** — `draw()` paints sky, terrain, targets, ship, shots and the
  fuel bar; the start/pause/game-over panel is DOM (`#overlay`) so tests can
  read it as text.

`launchEnabled` switches rocket launching off; the specs use it to run long
simulations that stay deterministic, exactly as BurgerTime's `spawnEnabled`
does.

## Testing

`Scramble/tests/scramble.spec.js` drives the real page over `file://` with
Playwright and covers: initial state and HUD, starting, steering and clamping,
terrain invariants (corridor width, section layout, determinism), laser and
bomb behaviour, fuel drain and refuelling, rocket launching, every crash
source, checkpoint respawn, level clear and progression, pause, best-score
persistence, and that `draw()` paints and never throws in any state.

The suite was written before the implementation: each block was added red and
made green, which is why the game exposes seams like `placeShip`,
`launchEnabled` and `corridorMidY` — the tests needed them.

## Assumptions

These are the calls made where the brief left room, resolved toward the simpler
reading:

- **Branch name.** The task asked for a branch named after the game
  (`scramble`), but this session is pinned to the designated development branch
  `claude/loving-euler-vzqz58` and is told never to push elsewhere. The
  designated branch wins; the game name lives in the folder, the commit and the
  PR title instead.
- **Respawn is checkpoint-based, not positional.** Classic Scramble sends you
  back to the start of the section; restarting mid-air where you died would be
  unfair with terrain right in front of you. Sections are the checkpoints.
- **Invulnerability covers terrain too.** For the 1.5 s after a respawn nothing
  can kill you except running out of fuel — including the ground. It is the
  simpler rule and it keeps a respawn from cascading into another crash.
- **Destroyed targets in the current section come back on respawn.** The
  section restarts as a unit; targets *behind* the checkpoint stay destroyed.
- **The base is a bonus, not a gate.** Bombing it is worth 800 points but the
  level clears on reaching the end either way, so a bad bomb run cannot strand
  the player.
- **No distance score.** Points come from targets and the level bonus only,
  which keeps scoring legible instead of inflating with flight time.
- **No audio.** No other game in the repo ships sound, and it is untestable
  headless.
- **Rockets fly straight up.** No homing — the threat is timing and position,
  which is both truer to the original and simpler to reason about.
