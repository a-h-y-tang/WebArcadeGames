# Tank Battle — Design

## Concept

Tank Battle is a top-down armoured skirmish inspired by the 1985 arcade classic
*Battle City*. You command a single tank on a 15×15 tile battlefield. Enemy tanks
roll in from the top edge and push down toward the **eagle base** you are
defending at the bottom of the map. Brick walls crumble under fire and can be
tunnelled through — by you *and* by the enemy — while steel walls stop shells
dead. Destroy every enemy in a level to advance; lose your last tank or let a
shell reach the eagle and the war is over.

## Mechanics

- **The battlefield** is a 480×480 canvas divided into a 15×15 grid of 32px
  cells. Tanks are 28px, so a tank fits a lane with 2px of clearance on each
  side.
- **Terrain** is one of three tiles: empty ground, **brick** (blocks tanks and
  shells, destroyed by a single hit) and **steel** (blocks tanks and shells,
  indestructible). The canvas edges behave like steel.
- **Driving.** Tanks move axis-aligned at a constant speed. Turning to a new
  direction *snaps* the tank onto the centre of the perpendicular lane (the
  arcade original does the same), so a tank is always aligned with the grid when
  it turns a corner and can never get wedged half-way into a wall. A move that
  would end inside terrain, the base or another tank is clipped so the tank ends
  flush against the obstacle.
- **Shells.** Firing launches a shell from the muzzle in the tank's facing
  direction. You may have **one shell in flight at a time**; each enemy tank is
  likewise limited to one. A shell that hits brick destroys that cell and is
  consumed; a shell that hits steel, a wall, a tank or the base is consumed too.
- **Combat.** Your shells destroy enemy tanks; enemy shells destroy you. Losing
  a tank costs a life and you roll back out from the spawn cell after a short
  delay with two seconds of shield. Any shell that reaches the eagle destroys
  the base and ends the game immediately, however many lives are left.
- **Levels.** Each level has a fixed quota of enemies to destroy. They trickle
  in from three spawn points along the top edge on a timer, with a cap on how
  many are on the field at once. Clearing the quota rebuilds the battlefield,
  restocks the quota and increases the difficulty; score and lives carry over.
- **Scoring.** Each kill is worth `100 × level`. The best score is persisted in
  `localStorage` under `tankbattle-best`.

### Difficulty scaling (all derived purely from `level`)

| Quantity            | Formula                                            |
|---------------------|----------------------------------------------------|
| `enemiesForLevel`   | `6 + (level-1) * 2`                                |
| `enemySpeed`        | `58 + (level-1) * 7` px/s                          |
| `enemyFireInterval` | `max(0.55, 1.7 - (level-1) * 0.12)` s              |
| `maxActive`         | `min(5, 3 + floor((level-1) / 2))`                 |
| `pointsPerKill`     | `100 * level`                                      |

## Map generation

Levels are generated procedurally but **deterministically**: `buildLevel(lv)`
seeds the PRNG from the level number, so level 3 always looks the same and the
tests can assert on it.

Walls are only ever placed on **odd columns and even rows**. That leaves every
even column and every odd row completely open, which guarantees a connected road
network from any spawn point to the base without needing a pathfinding check —
the map can never generate an unwinnable layout. The eagle's brick fort
(five cells around the base) is stamped on afterwards.

## Controls

| Input                       | Action                        |
|-----------------------------|-------------------------------|
| ← ↑ ↓ → / W A S D           | Drive the tank                |
| Space                       | Fire (start / restart when idle or after a game over) |
| P                           | Pause / resume                |

## Determinism & testing

Following the pattern used by the other games in this repo (Kaboom, Dino Run,
Tetris, Snake), the game is a single classic (non-module) script so its state and
functions are reachable from Playwright as plain globals. All motion is expressed
per-second and advanced through `step(dt)`, which runs fixed 1/120s sub-steps
internally, so tests simulate frames by calling `step()` directly rather than
depending on `requestAnimationFrame` wall-clock timing.

Every random choice — map generation, enemy AI direction changes, fire timing,
explosion particles — goes through the seeded PRNG (`seedRng` / `rand`), and
`buildLevel` reseeds from the level number, so the battlefield is reproducible
regardless of how much AI has run beforehand. Tests that need a quiet board clear
`enemies`, set `enemiesToSpawn = 0` and place pieces directly with
`spawnEnemy({cx, cy})` and `spawnBullet({x, y, dir, owner})`, so no test depends
on the AI making a particular choice.

## Assumptions

These choices were made where the brief was open-ended; the simpler option was
taken each time and recorded here:

- **Branch naming.** The task asked for a branch named after the game
  (`tank-battle`), but the session's standing instruction pins development to
  `claude/loving-euler-7f07f6`. The pinned branch wins, since pushing elsewhere
  is explicitly forbidden; the game folder carries the name instead.
- **Two terrain types.** The arcade original also has water, forest and ice
  tiles. Only brick and steel are implemented — they carry the core "shoot
  through the soft walls, route around the hard ones" decision, and the extra
  tiles are cosmetic variations on blocking rules already covered.
- **No power-ups.** The original drops helmets, shovels, stars and timers.
  Omitted; the difficulty curve comes from level scaling alone.
- **One tank type.** All enemies share one speed and fire rate for a given level,
  rather than the original's four armour classes.
- **A single brick cell per hit.** In the original a shell chips a half-cell.
  Here a shell destroys the whole 32px cell it hits — simpler, and it keeps the
  terrain grid a plain integer array.
- **Friendly fire is off.** Enemy shells pass through enemy tanks, and your own
  shells cannot hurt you. Shells *do* destroy the base regardless of who fired
  them, so a careless shot into your own fort can still lose the game.
- **No enemy spawn protection.** An enemy is vulnerable the instant it appears;
  it only gets a brief visual flash. The player, by contrast, does get two
  seconds of shield after respawning.
- **Base loss is terminal.** Losing the eagle ends the game immediately rather
  than costing a life, matching the original's single-player rules.
- **Single player only.** The original's two-player co-op mode is out of scope.
