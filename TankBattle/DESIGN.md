# Tank Battle — Design

## Game concept

Tank Battle is a top-down arena shooter. You drive a single tank around a walled
560×504 arena built from brick, steel and water. Enemy tanks roll in from the top
edge and hunt either you or the command base tucked into the bottom wall.

Two things can end a run: losing your last tank, or losing the base. Destroy
every tank in a wave and the next arena loads with more, faster, tougher tanks.
The arena is destructible, so the map you defend in minute two is the one your
own shells reshaped in minute one — shoot away the wrong brick and you have
opened the lane an enemy needed.

The three-tank-type roster (basic, fast, armour), the destructible brick, the
shell-proof steel, the eagle-style base and the shield/star/extra-life drops are
the classic *Battle City* / *Tank Battalion* arcade vocabulary.

## World geometry

The arena is a fixed grid: `COLS = 20` columns × `ROWS = 18` rows of `TILE = 28`
pixels, so the canvas is exactly 560 × 504 and never scrolls.

Each cell holds one of five tile characters:

| Char | Tile  | Blocks tanks | Blocks shells | Notes                              |
|------|-------|--------------|---------------|------------------------------------|
| `.`  | open  | no           | no            | driveable ground                   |
| `#`  | brick | yes          | yes           | one shell removes the whole tile   |
| `@`  | steel | yes          | yes           | only an upgraded (star) shell cuts it |
| `~`  | water | yes          | no            | shells fly straight over it        |
| `E`  | base  | yes          | yes           | any shell that reaches it ends the run |

Three arenas are hand-laid as arrays of 20-character strings in `MAPS` and are
cycled by level (`mapForLevel`), so level 4 replays arena 1 with a harder wave.
Every map obeys three invariants, all covered by the spec:

- the three spawn tiles along the top edge (`SPAWN_POINTS`, columns 0, 9 and 19)
  and the player's tile (`PLAYER_SPAWN`, column 6 of the bottom row) are open;
- the base is a 2×2 block of `E` at columns 9–10, rows 16–17, wrapped in a brick
  cocoon;
- the vertical lane straight above the base (columns 9–10, rows 13–14) is sealed
  with steel.

That steel plug is a balance fix rather than decoration. The middle spawn column
sits directly above the base, so without it enemy tanks drove one straight line
from spawn to base, chewed through the single brick cocoon and finished a run in
8–15 seconds. Steel cannot be shot away by enemy fire, so tanks must now work
around to the base's flanks — which takes long enough for a defender to respond.

## Mechanics

### Driving

Tanks are 24 px squares that move on one axis at a time at a constant speed.
`advanceTank` walks the tank forward in 1 px slices and stops the moment the next
slice would overlap a blocking tile, the arena edge or another tank, so a tank
always ends up flush against whatever stopped it. The `blocked` flag it sets is
what tells the enemy AI to pick a new direction.

Corridors are one tile wide, so a tank that turns needs to line up with the lane
it is turning into. While travelling, the coordinate on the *other* axis is
eased toward the nearest tile centre (`laneCentre`) at the tank's own speed. Turn
into a corridor a few pixels off and the tank slides into the middle of it
instead of grinding on a corner.

### Shells

`fireTank` puts one shell in the air per tank — the player's re-fires as soon as
the previous shell is gone (plus a 0.15 s reload), which is what makes a duel a
matter of timing rather than button mashing. Shells step in 2 px slices and
resolve against, in order: the arena edge, the tile they are over, then every
tank that is not their owner. Enemy shells pass harmlessly through other enemy
tanks — there is no friendly fire between the AI's own tanks — but the player's
base is fair game for anyone, including the player. Opposing shells that pass
within 10 px cancel each other out.

Brick vanishes a whole tile at a time. Steel stops an ordinary shell dead and
only breaks for a star-upgraded one, so the star is also a liability: it lets you
punch through your own base's steel plug.

### Enemy AI

Each tank re-decides its direction when it is blocked or when its think timer
expires (0.5–1.7 s). It picks a target — the base with probability
`BASE_HUNT_CHANCE`, otherwise the player — and then, 60% of the time, takes the
open direction that most reduces the distance to that target; the rest of the
time it picks any open direction. "Open" is probed from the lane centre, so a
tank a pixel off centre does not mistake a clear corridor for a wall.

Every `ENEMY_SHOOT_INTERVAL` (0.85 s) a tank decides whether to shoot. It always
shoots when it is genuinely lined up: `aimedAt` checks that the target is ahead
along the barrel and within 0.7 of a tile perpendicular, and `clearShot` then
walks the lane tile by tile to confirm nothing blocks it. Otherwise it takes a
speculative shot with probability `ENEMY_SHOOT_CHANCE` (0.25) — which is how
walls get chewed open over time. A tank never spends an aimed shot on a shielded
player.

### Waves, lives and levels

A wave is a list of tank types (`enemyPlanForLevel`): 8 tanks at level 1, two
more per level up to 20, with fast and armour tanks mixed in more often as levels
climb. `updateSpawner` feeds them in one at a time from the three top-edge spawn
points, no more than `maxOnFieldForLevel` (4 rising to 6) at once, every
`spawnIntervalForLevel` seconds (3.2 s shrinking to a 1.2 s floor). A tank spends
its first 0.6 s materialising: it cannot move, shoot, be shot or block anyone.

Being hit costs a life and the star upgrade; the tank returns to its spawn tile
after 1.2 s with a 2.5 s shield. Run out of lives, or let a shell reach the base,
and the run ends — `overReason` distinguishes the two so the overlay can say
which. Clearing a wave pays 500 and, after a two-second banner, loads the next
arena.

### Power-ups

Every fourth tank destroyed drops one power-up on a random open tile, cycling
shield → star → extra life. Deliberately a fixed cadence rather than a random
roll: it is predictable enough to play around, and it keeps the specs
deterministic. Drops are worth 200 points and expire after 14 s, blinking out
over the last three.

## Controls

| Input | Action |
|---|---|
| <kbd>←</kbd> <kbd>→</kbd> <kbd>↑</kbd> <kbd>↓</kbd> or <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> | drive (hold) |
| <kbd>Space</kbd> | fire |
| <kbd>Space</kbd> / <kbd>Enter</kbd> | start, or restart after game over |
| <kbd>P</kbd> | pause / resume |

Holding two direction keys drives in the most recently pressed one; releasing it
falls back to the other. Releasing everything stops the tank, and it keeps facing
wherever it last drove — so you can stop and shoot down a corridor.

## Code structure

`game.js` is a single classic (non-module) script, matching BurgerTime, Snake and
Tetris in this repo, so its state and helpers are reachable from the Playwright
specs as plain globals.

- **Constants** — arena geometry, `MAPS`, tank/shell/wave/power-up tuning.
- **Seeded RNG** — `setSeed`/`rng` (mulberry32). The live game seeds from the
  clock; a spec calls `setSeed` when it wants repeatable AI behaviour.
- **Grid helpers** — `tileAt`, `setTile`, `centerOf`, `colOf`/`rowOf`,
  `laneCentre`, and the per-material `blocksTank`/`blocksShell` predicates.
- **Collision and motion** — `tankBlocked`, `advanceTank`.
- **Entities** — `placePlayer`, `spawnEnemy`, `fireTank`/`fire`, `destroyEnemy`,
  `killPlayer`, `destroyBase`, `damageTank`.
- **AI** — `chooseEnemyDir`, `aimedAt`, `clearShot`, `enemyAimed`.
- **Simulation** — `updateEnemies`, `updateShells`, `updatePowerups`,
  `updateExplosions`, `updateSpawner`, `checkLevelClear`, all driven by
  `step(dt)`.
- **Flow** — `startGame`, `loadLevel`, `nextLevel`, `endGame`, `togglePause`.
- **DOM and input** — HUD/overlay updates and the key handlers.
- **Rendering** — `draw()` and its per-thing painters.

All motion is expressed per second and advanced through `step(dt)`, and `draw()`
is pure output. The animation loop is the only place that reads the clock, so the
specs simulate exact frame counts (`step(1/60)`) instead of waiting on
`requestAnimationFrame`.

## Testing

`tests/tankbattle.spec.js` drives the real page over `file://` with Playwright.
The specs were written before the game existed and cover the idle state, driving
and collision against each material, shell behaviour per material, enemy tanks
(damage, lives, respawn, shields, aiming and line of sight), the base, power-ups,
level progression, pause, best score and rendering in every state.

Two conventions keep them from racing the live animation loop, which keeps
running while a spec pokes at the page: a key press is confirmed against
`player.dir` before the simulation is advanced, and any arrangement that must
survive between two `evaluate()` calls is set up in one call. Test-only hooks in
the game are deliberately small: `spawnEnabled` to stop reinforcements, `frozen`
to hold a tank still, and `setSeed` for repeatable AI.

Run them with `npx playwright test TankBattle/tests/` from the repo root.

## Assumptions

The task left some things open. Where a reading was ambiguous, the simpler one
was taken and noted here.

- **Brick takes one hit, not two.** The classic game shaves half-tile chunks off
  a brick wall; here a shell clears the whole 28 px tile. One tile is the unit of
  both the grid and the map format, which keeps collision and rendering simple.
- **Trees, ice and the freeze/grenade power-ups are left out.** The tile set is
  brick, steel and water; the drops are shield, star and extra life. Enough
  material variety to make the arenas interesting without a second system.
- **The star is a single upgrade level, not a stack.** It makes your shell faster
  and steel-piercing, and you lose it when you lose a tank.
- **Power-ups drop on a fixed cadence** (every fourth kill, cycling the three
  types) rather than from a random roll on a special "bonus" tank.
- **Friendly fire can destroy your own base.** Authentic to the original and a
  real tactical constraint, so it stayed — the specs pin the behaviour.
- **Play is endless.** After the third arena the maps cycle with harder waves
  instead of ending in a victory screen, matching how the other arcade games in
  this repo score a run.
- **Enemy tanks do not damage each other**, so the AI cannot dismantle its own
  wave, and they never drop the base-defence "grenade" behaviour of the original.
- **One shell in the air per tank**, player included; the shell must land or
  leave the arena before the next one.
- **Development branch.** The task asked for a branch named after the game
  (`tank-battle`); the session's standing instruction pins all work to
  `claude/loving-euler-326npx`, so that branch was used.
