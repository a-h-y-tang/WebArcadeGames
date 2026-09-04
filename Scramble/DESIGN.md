# Scramble — Design

## Concept

A side-scrolling cave flyer. Your jet is dragged forward through a procedurally
generated canyon at a constant speed; you control only where in the canyon you
sit. Fuel drains the whole time, and the only way to top it up is to blow up the
fuel dumps sitting on the canyon floor — so the game is a constant trade between
flying the safe line through the terrain and diving low enough to bomb the
tanks that keep you alive.

Six sub-systems make the game:

1. **Terrain** — a per-column heightmap (floor + ceiling) generated from a
   seeded PRNG, so a given level number always produces the same canyon.
2. **Fuel** — drains at a fixed rate; hitting zero costs a life.
3. **Guns** — a forward laser and a forward-arcing bomb.
4. **Targets** — fuel dumps (score + fuel) and ground rockets (score) that
   launch at you when you get close.
5. **Lives / crashes** — terrain, rockets and dry tanks all kill you.
6. **Levels** — reach the end of the canyon and a longer, faster one is built.

## Mechanics

### Scrolling and the camera

Everything lives in **world coordinates**. The camera `camX` advances at
`scrollSpeed()` = `SCROLL_BASE + (level - 1) * SCROLL_STEP` px/s. Screen X is
`worldX - camX`; world Y and screen Y are the same (there is no vertical
scrolling). The ship is dragged along with the camera every frame, so the
player's horizontal input only moves it *within* a window on screen
(`SHIP_MIN_SX`…`SHIP_MAX_SX`) — you can never outrun or be left behind by the
camera.

### Terrain

`buildLevel()` fills `terrain` with `LEVEL_COLS + MARGIN_COLS` entries of
`{ ground, ceil }`, both in pixels. Column width is `COL_W`. The floor is a
random walk (clamped to `GROUND_MIN`…`GROUND_MAX`), and from level 2 onward a
ceiling walk is added. The ceiling is always trimmed so that
`CANVAS_H - ground - ceil >= MIN_GAP`, which guarantees a flyable corridor.
The first `SAFE_COLS` columns are forced flat with no ceiling so the respawn
point is never inside rock.

`groundHeightAt(worldX)` / `ceilHeightAt(worldX)` sample the column under a
world X, clamped at both ends of the array.

### Fuel

`fuel` starts at `FUEL_MAX` (100) and drops by `FUEL_DRAIN` per second while
the ship is alive. A destroyed fuel dump adds `FUEL_PER_TANK`, capped at
`FUEL_MAX`. Running dry calls the same `crash()` path as flying into a wall.
The HUD shows the number and a bar (`#fuel-fill`) whose width is the percentage
remaining; it turns amber below 40% and red below 20%.

### Weapons

* **Laser** (`fire()`, Space) — up to `BULLET_MAX` in the air, travelling
  `BULLET_SPEED` px/s through the world. Dies on terrain, on a target, or once
  it leaves the screen.
* **Bomb** (`dropBomb()`, B) — up to `BOMB_MAX` in the air, spawned with the
  ship's forward momentum (`scrollSpeed() + BOMB_VX`) and accelerated downward
  by `BOMB_GRAVITY`. When it reaches the floor it explodes, and anything within
  `BLAST_R` of the impact point is destroyed.

Both weapons destroy both target types; bombs are the practical way to hit
things standing on the floor, lasers the practical way to hit a launched
rocket.

### Targets

* **Fuel dumps** (`tanks`) — `{ x, y, alive }` standing on the floor.
  Destroying one scores `TANK_POINTS` and adds fuel.
* **Rockets** (`rockets`) — `{ x, y, alive, launched }`. A rocket launches when
  the ship comes within `ROCKET_TRIGGER` world px, then climbs at
  `ROCKET_SPEED` px/s (increasing per level) until it leaves the top of the
  screen. Destroying one scores `ROCKET_POINTS`. Touching one kills you.

Both are placed by the level builder at pseudo-random column intervals, never
in the safe zone, and never on a column whose corridor is too tight.

### Crashes, lives, levels

`crash()` decrements `lives`, marks `ship.alive = false` and starts a
`RESPAWN_DELAY` timer. If lives hit zero the game ends and the overlay shows
GAME OVER (with the best score written to `localStorage` under
`scramble-best`). Otherwise the *current* level restarts: `camX` back to 0,
fuel refilled, targets restored.

Flying past `LEVEL_LEN` px advances the level: score gains
`LEVEL_BONUS + round(fuel) * FUEL_BONUS_MULT`, fuel refills, a new canyon is
built and the scroll speed goes up.

### Scoring

| Event | Points |
|---|---|
| Fuel dump destroyed | 100 (+15 fuel) |
| Rocket destroyed | 80 |
| Level cleared | 500 + 5 × remaining fuel |

## Controls

| Key | Action |
|---|---|
| ↑ / W | Climb |
| ↓ / S | Dive |
| ← / A | Slow down (drift back on screen) |
| → / D | Speed up (drift forward on screen) |
| Space | Fire laser (also starts the game) |
| B | Drop bomb |
| P | Pause / resume |
| Enter | Start / restart |

## Code layout

`game.js` is a single classic (non-module) script — like Kaboom!, BurgerTime and
Snake in this repo — so every piece of state is a plain global reachable from
the Playwright specs. All motion is expressed per second and applied by
`step(dt)`, which the real animation loop calls with the frame delta and the
tests call directly with a fixed `dt`. Nothing in the simulation reads the wall
clock, so the specs are deterministic.

Test-facing hooks:

* `state`, `score`, `best`, `lives`, `level`, `fuel`, `camX`
* `ship`, `bullets`, `bombs`, `rockets`, `tanks`, `terrain`
* `step(dt)`, `startGame()`, `togglePause()`, `fire()`, `dropBomb()`,
  `buildLevel()`, `crash()`, `groundHeightAt(x)`, `ceilHeightAt(x)`,
  `columnIndexAt(x)`, `scrollSpeed()`, `shipScreenX()`
* `fuelDrainEnabled` — set to `false` so long simulations don't run dry

## Assumptions

These were decided without a human in the loop; each takes the simpler reading.

1. **Branch name.** The task asked for a branch named after the game
   (`scramble`), but this session is also under a standing instruction to
   develop and push only on `claude/compassionate-ramanujan-opw6fv`. The
   standing branch instruction wins, so the work lives there; the game folder
   and PR title carry the game's name instead.
2. **Checkpoints.** The arcade original restarts you at a section checkpoint.
   Here a crash restarts the *current level* from its beginning, which needs no
   extra checkpoint bookkeeping and keeps the level-reset path identical to the
   level-start path.
3. **One canyon per level.** The original is six distinct sections (caves,
   city, tunnel, base) in one continuous run. Here each level is a single
   generated canyon that gets faster and gains a ceiling from level 2; this
   keeps the terrain model to one heightmap.
4. **No end state.** Levels continue indefinitely with rising scroll speed
   rather than ending after a fixed count.
5. **Bombs explode on the floor only** — they don't detonate on contact with a
   target in mid-air. The blast radius handles the near-miss case.
6. **Rockets fly straight up** rather than homing, so their behaviour is
   trivially deterministic in tests.
7. **Sound is omitted**, matching the rest of the repo.
