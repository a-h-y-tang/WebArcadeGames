# Defender — Design

## Concept

Defender is a scrolling-world arcade shooter inspired by the 1981 Williams
classic. You pilot a ship over a wrapping planet **four screens wide** and
defend ten **humanoids** standing on the terrain. Green **landers** drop out of
the sky, hunt for humanoids, grab one each and haul it to the top of the
screen. A lander that escapes with its captive turns into a fast, aggressive
**mutant** that hunts you instead.

Because the planet is far wider than the window, most of the action happens
off-screen. The **scanner** (the strip along the top of the canvas) shows the
whole planet at once, centred on your ship — reading it and flying to the right
place in time *is* the game.

Shoot a carrying lander and its humanoid falls. Catch it in mid-air, fly it
down to the terrain and set it back on the ground for a big bonus. Let it drop
from height and it dies. Lose every humanoid and the planet falls: all
remaining landers instantly mutate.

## Mechanics

### World

- The canvas is **800×460**. The top **70px** is the scanner; the flyable
  playfield is everything below it.
- The world is **3200px** wide and wraps: `wrapX()` normalises a coordinate,
  and `wrapDelta(a, b)` gives the shortest signed distance between two points
  around the planet. Every distance, collision and AI decision in the game is
  expressed with `wrapDelta`, so nothing breaks at the seam.
- Terrain is a 128-point height field built by a seeded random walk, smoothed
  twice, with the tail blended into the head so the wrap is invisible.
  `groundY(x)` interpolates between points.
- The camera leads the ship: it sits 32% of a screen behind the nose when you
  face right, 68% when you face left, eased toward that target and hard-clamped
  so the ship can never leave the window.

### Ship

- Horizontal thrust accelerates at `ACCEL_X` up to `MAX_VX`, with drag when you
  let go. Pressing left/right also **flips the ship**, which is what determines
  the camera lead and the direction your shots travel.
- Vertical thrust is symmetric (up/down), clamped between the scanner and the
  terrain.
- Up to `MAX_BULLETS` (6) shots are alive at once; each lives `BULLET_LIFE`
  (0.55s), which is what limits your effective range.
- **Smart bomb** (`B`) destroys every lander and mutant within `BOMB_RANGE`
  (half a screen) of the ship and scores them normally. You start with 3 and
  earn one per wave, capped at 6.
- **Hyperspace** (`H`) teleports the ship to a random point elsewhere on the
  planet, with a 3s cooldown and a short grace period on arrival.

### Landers

A lander is a small state machine:

| State      | Behaviour                                                                 |
|------------|---------------------------------------------------------------------------|
| `hunting`  | Homes on the nearest humanoid whose state is `ground`, descending at `LANDER_DESCEND` while above it. Grabs it on contact (`GRAB_R`). |
| `carrying` | Climbs at `LANDER_CLIMB`, holding the humanoid `CARRY_OFFSET` below it. On reaching the top the humanoid is destroyed and the lander becomes a mutant. |

If no humanoid is left to hunt, a lander drifts and hovers. Landers and mutants
both fire aimed shots on a randomised 1.6–3.8s timer, but only when the player
is within 60% of a screen width — off-screen enemies never snipe you.

Mutants steer toward the ship with acceleration `MUTANT_ACCEL` capped at
`MUTANT_SPEED`, plus a small sine wobble, and are clamped to the playfield.

### Humanoids

States: `ground` → `abducted` → (destroyed) or `falling` → `carried` → `ground`.

- A falling humanoid accelerates at `FALL_G` up to `FALL_MAX`. It survives
  impact only if it hits the ground below `SAFE_IMPACT` — roughly a 56px drop.
- Flying within `CATCH_R` of a falling humanoid catches it (one at a time).
- Flying within `DROP_H` of the terrain while carrying sets it down: the
  humanoid returns to `ground` and you score `SCORE_RESCUE`.
- If a carrying lander dies, its humanoid starts falling. If the *ship* dies
  while carrying, the humanoid is released too.

### Waves, scoring and lives

| Event                                   | Points |
|-----------------------------------------|--------|
| Lander destroyed                        | 150    |
| Mutant destroyed                        | 150    |
| Humanoid returned to the ground         | 500    |
| Each humanoid alive when a wave is cleared | 100 |

- Wave *n* spawns `min(18, 4 + 2n)` landers, placed a quarter to three quarters
  of the planet away from the ship so nothing materialises on top of you.
- A wave is cleared when no landers *and* no mutants remain; after a
  `WAVE_DELAY` of 2.5s the next wave spawns. Surviving humanoids **carry over**
  — they are never restocked, so a wave lost is lost for good.
- Three ships. Any contact with a lander, a mutant or an enemy shot costs one
  (and destroys the enemy you hit). Respawning grants 2.5s of invulnerability,
  shown as a flashing ship.
- The best score is persisted in `localStorage` under `defender-best`.

## Controls

| Input             | Action                          |
|-------------------|---------------------------------|
| ← / A , → / D     | Thrust and turn                 |
| ↑ / W , ↓ / S     | Climb / dive                    |
| Space             | Fire (also starts the game)     |
| B                 | Smart bomb                      |
| H                 | Hyperspace                      |
| P                 | Pause / resume                  |

## Code layout

Single non-module `game.js`, matching the rest of the repo, so every piece of
state is a global the Playwright suite can inspect and drive:

- **Helpers** — `wrapX`, `wrapDelta`, `groundY`, `radarX`, `screenX`.
- **Factories** — `makeLander`, `makeMutant`, `makeHumanoid`,
  `landerCountForWave`.
- **Simulation** — `update(dt)` calls `updatePlayer`, `updateCamera`,
  `updateBullets`, `updateEnemyBullets`, `updateLanders`, `updateMutants`,
  `updateHumanoids`, `checkPlayerCollisions`, `checkPlanet`, then the
  wave-clear timer. `update()` is a no-op unless `state === 'running'`, which
  is what makes pausing (and the paused-simulation test) trivial.
- **Rendering** — `draw()` paints stars, terrain, entities and the scanner.
  Rendering never mutates game state, so tests can step the simulation without
  drawing a single frame.
- **RNG** — a seeded mulberry32 (`setSeed` / `rng`). Terrain, humanoid
  placement, spawn points and enemy fire timers all draw from it, so seeding
  reproduces an entire planet; the tests use that for the terrain check.

`requestAnimationFrame` only ever calls `update(dt)` and `draw()`, so the
browser loop and the test harness exercise exactly the same code.

## Assumptions

These were judgement calls made while building this autonomously; the simpler
reading was taken every time.

1. **Branch name.** The task asked for a branch named after the game
   (`defender`), but this session is required to develop and push on its
   designated branch `claude/loving-euler-7cg6n7`. The designated branch wins;
   no `defender` branch was created.
2. **Humanoids stand still.** In the arcade original they wander along the
   ground. Here they are stationary, which keeps lander pursuit and the test
   suite deterministic without changing how the game plays.
3. **One humanoid at a time.** The ship can carry a single humanoid; the
   original allowed a stack. Simpler to fly, simpler to draw.
4. **Hyperspace is safe.** The original occasionally destroyed the ship on
   re-entry. Here it always succeeds and is balanced by a 3s cooldown instead.
5. **No baiters, bombers, pods or swarmers.** The enemy roster is landers plus
   mutants — enough for the abduction loop that defines the game, without a
   sprawl of behaviours the tests would have to pin down.
6. **Humanoids are never restocked** between waves, and the "planet falls"
   event mutates the remaining landers but does not end the game or alter the
   terrain.
7. **Fixed canvas size**, like every other game in this repo — no responsive
   resizing beyond CSS `max-width`.
