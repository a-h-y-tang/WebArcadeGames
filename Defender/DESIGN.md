# Defender — Design

A side-scrolling rescue shooter on an HTML5 canvas, inspired by Williams'
1981 arcade game *Defender*. Plain HTML/CSS/JS — no build step, no
dependencies — matching the conventions of every other game in this repo.

## Game concept

You pilot a ship patrolling a wrap-around planet surface. Alien **Landers**
descend from orbit, grab the **Humanoids** walking on the ground and haul them
skywards. A lander that reaches the top of the sky with a humanoid mutates into
a fast, aggressive **Mutant**. Shoot the landers, catch the humanoids they drop
and carry them back to the ground. Lose every humanoid and the planet dies:
the surface turns to rubble and every remaining lander mutates at once.

The world is much wider than the screen (3200 px vs an 800 px view) and wraps
around, so the **scanner** strip at the top of the screen — a squashed map of
the entire planet — is how you find trouble that is off-screen.

## World model

| Concept | Value |
|---|---|
| World width | 3200 px, wraps at both ends |
| Main view | 800 × 400 px |
| Scanner | 800 × 60 px strip above the view |
| Ground line | y = 360 |
| Sky ceiling | y = 20 (a lander that lifts a humanoid past y = 12 mutates) |

All horizontal positions are *world* coordinates. `wrapX(x)` folds a coordinate
into `[0, WORLD_W)`; `worldDx(from, to)` returns the shortest signed distance
between two world coordinates, which is what every AI, camera and collision
check uses so that objects near the seam behave correctly.

The camera leads the ship: it sits roughly a third of the way in from the edge
the ship is facing, so you can see where you are going. `camera.x` is smoothed
towards that target each frame and is itself a wrapped world coordinate.

The terrain is a jagged mountain line generated once from a fixed seeded PRNG,
so the planet looks the same on every run and the tests are deterministic. The
terrain is cosmetic — the ship is clamped above the ground line rather than
colliding with individual peaks (see Assumptions).

## Entities

**Player ship** — thrusts horizontally with acceleration and drag (so it
drifts, like the original) and moves vertically at a fixed rate. Firing sends a
fast, short-lived bolt in the direction the ship faces. The ship is clamped
between the sky ceiling and the ground.

**Humanoids** (`state`: `ground` → `carried` → `falling` → `held` → `ground`)
— ten of them, wandering slowly along the surface. A lander grabs one, a
destroyed lander drops one, the ship can catch a faller and fly it down.

**Landers** — descend towards the nearest grounded humanoid, grab it, then
climb. While alive they occasionally fire an aimed shot at the ship. Worth 150
points; 500 more if it was carrying a humanoid you then rescue.

**Mutants** — what a lander becomes when it reaches the top with a humanoid, or
what every lander becomes when the planet dies. They chase the ship with a
jittery, erratic drift and fire more often. Worth 150 points.

**Bullets** — `from: 'player' | 'enemy'`, each with a lifetime so shots do not
circle the world forever.

## Mechanics

- **Scoring**: lander 150, mutant 150, smart-bombed enemy 150, humanoid
  returned to the ground 500. Clearing a wave pays `100 × wave × humanoids
  still alive`.
- **Falling humanoids**: a humanoid released above y = 240 falls too far and
  dies on impact; released lower, it picks itself up and keeps walking. Catch
  one by flying into it, then descend to the ground to set it down for 500.
- **Planet death**: when the last humanoid dies, `planetDead` is set, every
  lander instantly mutates, and the ground is drawn as rubble. The next wave
  restocks the planet with a fresh set of humanoids.
- **Waves**: wave *n* spawns `min(5 + 2(n − 1), 15)` landers. Clearing every
  enemy advances the wave, pays the bonus and grants a smart bomb (cap 6).
- **Lives & smart bombs**: 3 lives, 3 smart bombs. A smart bomb destroys every
  enemy currently on screen. Being hit by a bullet or an enemy costs a life and
  grants 2 seconds of invulnerability; at zero lives the game ends.
- **Best score** persists in `localStorage` under `defender-best`.

## Controls

| Key | Action |
|---|---|
| ← / A | Thrust left (ship turns to face left) |
| → / D | Thrust right (ship turns to face right) |
| ↑ / W | Climb |
| ↓ / S | Dive |
| Space | Fire |
| B | Smart bomb |
| P | Pause / resume |
| Enter | Start / restart |

## Code structure

`game.js` is a single classic (non-module) script, so its state and helpers are
plain globals reachable from the Playwright specs — the same pattern used by
Kaboom!, Snake and Tetris here. All motion is expressed per second and advanced
by `step(dt)`, so tests simulate frames deterministically without depending on
`requestAnimationFrame` wall-clock timing.

Public surface used by the tests: `startGame`, `endGame`, `togglePause`,
`step`, `fire`, `smartBomb`, `setThrust`, `setVertical`, `spawnLander`,
`spawnMutant`, `spawnHumanoid`, `spawnBullet`, `killPlayer`, `wrapX`,
`worldDx`, `isOnScreen`, `humanoidsAlive`, `landersForWave`, plus the state
globals `state`, `score`, `best`, `wave`, `lives`, `smartBombs`, `planetDead`,
`player`, `enemies`, `humanoids`, `bullets`, `camera`.

## Assumptions

Decisions made autonomously where the brief was ambiguous; the simpler reading
was taken each time.

1. **Branch name.** The task asked for a branch named after the game
   (`defender`), but this session is pinned to the branch
   `claude/loving-euler-g2d3m6` and must not push elsewhere. Work is committed
   there; the game folder name (`Defender/`) carries the identity instead.
2. **Design doc filename.** The repo README asks for `design.md` while the task
   asked for `DESIGN.md`. Recent games (Kaboom!, Calcudoku, Pinball) all ship
   `DESIGN.md`, so this file follows them.
3. **Terrain is cosmetic.** Real Defender lets you crash into mountains. Here
   the ship is clamped above a flat ground line and the jagged terrain is
   decoration — it keeps the flight model simple and the tests stable.
4. **No hyperspace and no baiters.** The original's random-teleport panic
   button and the timer-driven Baiter enemy are omitted; landers and mutants
   give the wave enough shape without them.
5. **Simplified lander AI.** Landers home in on the nearest grounded humanoid
   in world-wrapped distance rather than reproducing the arcade's exact
   descent-and-hover pattern.
6. **Fixed terrain seed.** The mountain profile is generated from a constant
   seed rather than randomly per run, so screenshots and tests are repeatable.
7. **Smart bombs affect only the visible screen**, matching the arcade, and
   award the same points as shooting each enemy.
