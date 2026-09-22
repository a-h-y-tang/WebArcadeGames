# Planet Defender — Design

## Game concept

A side-scrolling rescue shooter on a wrapping planet. You fly a fast, thrust-and-
drift ship across a strip of alien surface that is four screens wide and joined
end to end, so flying far enough in one direction brings you back where you
started. Ten humanoids stand on the surface below. Alien **landers** drop out of
the sky, hunt a humanoid, grab it and haul it to the top of the atmosphere — and
any lander that escapes with its captive returns as a **mutant**: faster, erratic
and interested only in killing you.

The tension is that you cannot see the whole planet at once. A **scanner** strip
across the top of the canvas shows the entire world in miniature, so the game is
really about reading the scanner, deciding which abduction to interrupt, and
getting there in time. Shooting a lander that is already carrying a humanoid
makes the humanoid fall — from low down it lands safely, from high up it dies on
impact unless you fly into it, catch it, and carry it back down to the surface.

Nothing else in this repo uses a wrapping world larger than the viewport, a
minimap, or an escort/rescue objective layered on top of shooting, so this is a
genuinely new shape of play next to the fixed-screen shooters (Space Invaders,
Galaga, Centipede) and the single-screen platformers.

## World geometry

| Constant | Value | Meaning |
|---|---|---|
| `CANVAS_W` × `CANVAS_H` | 800 × 480 px | the canvas |
| `WORLD_W` | 3200 px | planet circumference — 4 screens, wraps at both ends |
| `SCANNER_TOP` / `SCANNER_H` | 8 / 56 px | the miniature whole-world scanner |
| `VIEW_TOP` | 76 px | top of the play area (below the scanner) |
| `GROUND_Y` | 436 px | the surface line humanoids stand on |
| `SHIP_MIN_Y` / `SHIP_MAX_Y` | 92 / 424 px | vertical limits of the ship |
| `ABDUCT_Y` | 84 px | altitude at which a lifting lander escapes |

All horizontal positions are world coordinates in `[0, WORLD_W)`. Two helpers do
every piece of wrap-aware arithmetic:

- `wrapX(x)` — normalises a world x into `[0, WORLD_W)`.
- `wrapDX(from, to)` — the *shortest signed* distance from one world x to
  another, always in `[-WORLD_W/2, WORLD_W/2)`. Chasing, aiming and collision all
  use it, so an enemy at x = 3190 correctly sees the ship at x = 10 as 20 px to
  its right rather than 3180 px to its left.

The camera keeps the ship a third of the way into the screen on the side it is
facing (`CAM_LEAD`, eased toward the target) so you can see where you are going.
`worldToScreen(x)` converts a world x to a screen x through `wrapDX`, and returns
a value outside the canvas for anything that is off-view — drawing simply skips
those.

The terrain is a jagged silhouette generated once per run from a seeded PRNG. It
is scenery: the ship is clamped above `SHIP_MAX_Y` rather than colliding with
peaks, which keeps flying readable and the physics honest with the tests.

## Mechanics

### Ship

Thrust-and-drift, not direct positioning. Left/right set `facing` immediately
(the ship flips) and apply `THRUST` horizontally; releasing lets velocity decay
by an exponential drag factor, so the ship coasts. Up/down are the same with a
smaller cap. Speed is capped at `MAX_VX` / `MAX_VY`, x wraps around the world and
y is clamped to the play area.

### Weapons

- **Laser** (`Space`) — a horizontal beam that leaves the nose in the direction
  the ship faces, travelling at `BULLET_SPEED` for `BULLET_LIFE` seconds. There
  is a short cooldown and a cap on shots in flight.
- **Smart bomb** (`B`) — destroys every enemy currently *on screen* (not the
  whole planet), scoring each one normally. You start with three and earn one per
  wave, capped at six.

### Enemies

| Type | Behaviour | Score |
|---|---|---|
| Lander | Descends toward the nearest humanoid, grabs it, lifts it to `ABDUCT_Y` | 150 |
| Mutant | Born from a successful abduction; accelerates toward the ship with a jitter | 150 |
| Baiter | Appears once a wave has dragged past `BAITER_AFTER` seconds; fast horizontal harrier | 200 |

Landers and baiters occasionally fire an aimed shot at the ship. Enemy bullets
travel in a straight line and expire; touching one, or touching any enemy, kills
the ship.

### Humanoids and rescue

A humanoid is in exactly one of four states:

- `ground` — wandering slowly along the surface.
- `carried` — held below a lifting lander, matching its position.
- `falling` — released, accelerating downward under gravity.
- `held` — caught by the ship and riding below it.

Shooting a carrying lander releases its humanoid into `falling`. A humanoid that
lands from a drop of more than `FATAL_FALL` (130 px) dies on impact; a shorter
drop simply returns it to `ground`. Flying the ship into a falling humanoid
catches it (`CATCH_POINTS`), and descending to the surface while holding one sets
it down safely (`RETURN_POINTS`).

If a lander reaches `ABDUCT_Y` with a captive, the humanoid is gone and the
lander becomes a mutant on the spot.

### Waves

Each wave spawns `min(4 + wave, 12)` landers at random positions around the
planet. The wave is cleared once no landers and no mutants remain; surviving
baiters are swept away with it. Clearing pays a bonus of
`WAVE_BONUS × wave × survivors`, awards a smart bomb, and the humanoids that made
it stay put for the next wave.

**Planet destruction.** If the last humanoid dies, the planet is lost: every
lander on the field mutates immediately, the terrain is redrawn as rubble, and
the wave becomes a pure survival fight. Surviving it restores the planet with a
fresh set of ten humanoids for the following wave. (The arcade original only
restores humanoids every few waves; restoring on the next wave is the simpler
rule and keeps a bad wave from making the rest of the run unwinnable.)

### Run structure

Three lives, one extra life every `EXTRA_LIFE_EVERY` (10,000) points. Dying pauses
the action for `DEATH_PAUSE`, clears nearby hazards and respawns the ship in the
middle of the view; a humanoid you were holding is dropped into `falling`. Best
score is kept in `localStorage` under `planet-defender-best`.

## Controls

| Input | Action |
|---|---|
| `←` `→` / `A` `D` | Thrust left / right (also flips the ship) |
| `↑` `↓` / `W` `S` | Thrust up / down |
| `Space` | Fire laser (also starts the game from the title or game-over screen) |
| `B` | Smart bomb |
| `P` | Pause / resume |

## Code shape

`game.js` is a single classic (non-module) script, matching BurgerTime, Snake and
Tetris in this repo: every piece of state is a plain global, so the Playwright
specs can read and drive it directly. All motion is expressed per second and
applied by `step(dt)`, and `draw()` is pure rendering, so the tests advance the
simulation frame by frame without depending on wall-clock timing.

Test hooks (all plain globals):

| Hook | Purpose |
|---|---|
| `autoStep` | Set to `false` to stop the `requestAnimationFrame` loop advancing the simulation, so tests own the clock entirely |
| `spawnEnabled` | Set to `false` to suppress baiter spawns during long simulations |
| `enemyFireEnabled` | Set to `false` to suppress enemy shots |
| `setSeed(n)` | Reseeds the PRNG (a small deterministic LCG — the game never calls `Math.random`) |
| `spawnLander(x, y)`, `spawnMutant`, `spawnBaiter` | Place a specific enemy for a specific scenario |

## Assumptions

These were the ambiguous points; in each case the simpler reading was taken and
recorded here rather than guessed at silently.

1. **Branch name.** The task asked for a branch named after the game
   (`planet-defender`), but this session is required to develop and push on its
   assigned branch `claude/loving-euler-ekxde6`. The assigned branch wins; the
   game name lives in the folder, the commit and the PR title instead.
2. **Terrain is scenery.** Mountains are drawn but do not collide — the ship is
   clamped to `SHIP_MAX_Y`. Collision against a jagged silhouette would add a lot
   of edge cases for very little play value.
3. **Whole wave spawns at once.** Landers for a wave all appear immediately at
   random world positions instead of trickling in, which makes "wave cleared"
   simply "no landers or mutants left" and keeps the scanner meaningful.
4. **Smart bomb is screen-wide, not planet-wide**, so it stays a positional
   decision rather than a free reset.
5. **No hyperspace.** The arcade original's random-teleport panic button is
   omitted; the smart bomb is the only panic button.
6. **Humanoids persist across waves** and are only replenished after a planet
   destruction, as described above.
7. **Fixed canvas size.** 800 × 480 with no responsive scaling, matching the
   other games in the repo.
