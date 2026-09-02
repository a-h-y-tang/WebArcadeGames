# Defender — Design

A single-file HTML5 canvas arcade game: `index.html` + `style.css` + `game.js`,
no build step and no dependencies. This document explains the concept, the
mechanics, the code structure and the assumptions made while building it.

## Concept

You fly a lone ship over a wrap-around planet surface, defending eight humanoids
from alien **landers**. Landers descend, grab a humanoid, and haul it to the top
of the sky; a lander that reaches the top mutates into a fast, aggressive
**mutant** that hunts you. Shoot the lander while it carries a humanoid and the
humanoid falls — catch it in mid-air and set it down gently for a big bonus, or
let it hit the ground from too high and it dies.

The playfield is three screens wide and wraps horizontally, so most of the
action happens off-screen. A **radar** strip across the top of the canvas shows
the whole planet at once: your ship, every alien, and every humanoid. Reading
the radar is the actual skill of the game.

Clear every alien in a wave to advance; lose all three ships and the game ends.

## Mechanics

### The world

- The world is `WORLD_W = 2400` px wide and wraps: `wrapX()` normalises a
  coordinate into `[0, WORLD_W)` and `worldDelta(a, b)` returns the shortest
  signed distance from `a` to `b` across the seam. Every distance test, every
  chase and every draw call goes through those two helpers.
- The terrain is a deterministic jagged ridge generated once from a small
  seeded LCG, sampled by `terrainAt(x)` with linear interpolation between
  vertices. The first and last vertex share a height so the ridge is continuous
  across the seam.
- The camera (`camX`) follows the ship with a lead offset in the direction the
  ship faces, so you see more of the space you are flying into. `screenX()`
  converts world → screen coordinates through the seam.

### The ship

- Horizontal motion is thrust-based: holding left/right accelerates up to
  `SHIP_MAX_SPEED` and flips the ship's facing; releasing coasts to a stop with
  drag. Vertical motion is direct (no gravity on the ship).
- The ship is clamped between the bottom of the radar strip and the terrain.
- **Firing** launches a bullet travelling in the ship's facing direction at
  `BULLET_SPEED`, up to `MAX_BULLETS` alive at once. Bullets expire after
  `BULLET_LIFE` seconds so they cannot loop the planet forever.
- **Smart bombs** destroy every alien currently visible on screen. You start
  with `START_BOMBS` and earn one per wave.

### Aliens

| Enemy | Behaviour |
|---|---|
| Lander | Seeks the nearest living humanoid on the ground, descends onto it, grabs it, then lifts toward the top of the sky. At `MUTATE_Y` it mutates. With no humanoids left it hunts the ship instead. Fires a plasma shot at the ship on a cooldown when the ship is within `FIRE_RANGE`. |
| Mutant | No abduction behaviour — it accelerates straight at the ship with a jittered heading, and fires faster than a lander. |

Shooting a lander that is carrying a humanoid drops the humanoid into a
free-fall; shooting a lander that has already lifted a humanoid off-screen is
too late.

### Humanoids

A humanoid is always in exactly one of four states:

- `ground` — walking slowly along the terrain.
- `grabbed` — attached below a lander that is lifting it.
- `falling` — free-falling under gravity, either because its captor was shot or
  because the ship released it.
- `carried` — riding under the ship after a mid-air catch.

A falling humanoid that reaches the terrain survives if its fall speed is at or
below `SAFE_FALL_SPEED`, otherwise it dies. Flying low with a carried humanoid
sets it down automatically and scores `SCORE_RESCUE`.

### Waves, scoring and lives

- Wave *n* spawns `min(5 + 2n, MAX_WAVE_LANDERS)` landers. Clearing every lander
  and mutant awards `SCORE_HUMAN_BONUS` per surviving humanoid, grants a smart
  bomb, and starts the next wave.
- Scores: lander `150`, mutant `150`, rescue `500`, humanoid alive at wave end
  `100`.
- Colliding with an alien or an enemy shot costs a life. The ship is then
  invulnerable for `RESPAWN_TIME` seconds while it re-materialises in the middle
  of the world. At zero lives the game is over and the high score is written to
  `localStorage` under `defender-highscore`.
- If every humanoid dies the planet is lost: all remaining landers instantly
  mutate, and no new humanoids appear for the rest of the game.

## Controls

| Key | Action |
|---|---|
| ← / A | Thrust left (and face left) |
| → / D | Thrust right (and face right) |
| ↑ / W | Climb |
| ↓ / S | Dive |
| Space | Start / restart — and fire while playing |
| B | Smart bomb |
| P | Pause / resume |

## Code structure

`game.js` is a single classic (non-module) script, matching the rest of this
repo, so every constant, state variable and function is a plain global that the
Playwright specs can reach through `page.evaluate`.

- **Geometry helpers** — `wrapX`, `worldDelta`, `terrainAt`, `screenX`.
- **State** — `state` (`idle` / `running` / `paused` / `over`), `score`,
  `lives`, `wave`, `bombs`, plus the entity arrays `bullets`, `enemyBullets`,
  `landers`, `mutants`, `humans`, `particles`.
- **Simulation** — `step(dt)` advances everything in one pass and is the only
  entry point into the physics. `frame()` converts `requestAnimationFrame`
  timestamps into `dt` and calls `step` then `draw`; the tests call `step`
  directly with a fixed `dt`, so no test depends on real frame timing.
- **Spawners and events** — `startGame`, `nextWave`, `spawnLander`,
  `spawnMutant`, `fire`, `smartBomb`, `killPlayer`, `endGame`, `togglePause`.
- **Rendering** — `draw()` paints the starfield, terrain, entities and the radar
  strip. Rendering never mutates simulation state, so a headless test that only
  calls `step` sees exactly the same behaviour a player does.

## Assumptions

These were ambiguous in the brief; the simpler reading was taken each time and
recorded here.

1. **Branch name.** The task asked for a branch named after the game
   (`defender`), but this session is pinned to the designated development
   branch `claude/compassionate-ramanujan-tlwfjn`, and that instruction wins.
   All work landed there.
2. **Scope of the arcade original.** Only landers and mutants are implemented.
   Baiters, bombers, pods and swarmers from the 1981 original are omitted — they
   add spawn variety, not new mechanics, and the wave curve already scales
   difficulty. Hyperspace (random teleport) is likewise omitted; the smart bomb
   covers the "get me out of trouble" role.
3. **Fixed-size playfield.** The canvas is a fixed 800×420 with a world exactly
   three screens wide, rather than a responsive canvas, matching the other games
   in this repo and keeping the radar scale constant.
4. **Enemy fire is cooldown-driven, not random.** Each alien carries a
   `fireTimer`; it fires when the timer expires and the ship is within range.
   Only the initial timer offset is randomised, which keeps every shot in the
   tests reproducible.
5. **Lander targeting is deterministic.** A lander always seeks the *nearest*
   living ground humanoid across the seam rather than picking one at random, so
   abduction sequences can be asserted exactly.
6. **Humanoid survival on landing** is decided by impact speed alone
   (`SAFE_FALL_SPEED`), not by the height it was dropped from — the same rule,
   expressed in the quantity the simulation already tracks.
7. **The planet is not destroyed visually.** Losing every humanoid mutates the
   remaining landers, but the terrain stays intact and play continues, rather
   than reproducing the original's scorched-planet mode. Humanoids are never
   replenished either way — the eight you start with are all you get, which is
   what makes the wave-end bonus worth defending.
8. **One canvas, no audio.** No sound effects, consistent with the other games
   in the repo.
