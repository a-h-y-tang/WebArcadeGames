# Tank Battle — Design

## Game concept

A single-screen, top-down arcade tank shooter on an HTML5 canvas. You drive one
tank around a walled maze made mostly of **brick** — and brick is ammunition's
problem, not yours: every shot you fire chews a hole through it, and so does
every shot the enemy fires. The map you start the level with is not the map you
finish it with.

Two things can end a run. Enemy tanks can shoot *you* (three lives), or they can
punch through to the **base** sitting in its little brick fortress at the bottom
of the screen. One hit on the base and the game is over regardless of how many
lives you have left — so the whole game is a tug-of-war between hunting enemies
and keeping the ground in front of your fortress intact.

Clear every tank in a wave and the next level builds a fresh maze with a nastier
roster. Some enemies flash: kill one of those and it drops a power-up.

Nothing else in this repo plays like it. `Bomberman` is grid-stepped bomb
placement, `ArtilleryDuel` is turn-based ballistics, `Tron`/`LightCycles` are
trail-avoidance. Tank Battle is free-roaming pixel movement over a *destructible*
tile map with an objective you have to defend — a genuinely new shape of play
here.

## World geometry

Everything is derived from a tile grid, which keeps the layout easy to reason
about and easy to assert on in tests.

| Constant | Value | Meaning |
|---|---|---|
| `TILE` | 28 px | one grid cell |
| `COLS` × `ROWS` | 20 × 20 | grid size (canvas is 560 × 560) |
| tank hitbox | 28 × 28 | exactly one tile — corridors are one tank wide |
| bullet | 6 × 6 | moves in sub-steps so it can never tunnel through a wall |

### Tile types

| Code | Tile | Blocks tanks | Blocks bullets | Notes |
|---|---|---|---|---|
| 0 | empty | no | no | |
| 1 | brick | yes | yes | destroyed by any bullet |
| 2 | steel | yes | yes | only a fully-upgraded bullet (power 3) breaks it |
| 3 | water | yes | **no** | shoot across it, can't drive across it |
| 4 | forest | no | no | drawn *over* tanks — drive in and vanish |
| 5 | base | yes | yes | one hit ends the game |

### Level generation

Levels are generated from a seeded PRNG (`mulberry32`), so `startGame(seed)`
always produces the same maze — which is what makes the specs reproducible.

Connectivity is guaranteed structurally rather than by a search: every cell on a
**lane** — `col % 4 === 0`, `row % 4 === 0`, or the last row/column — is forced
empty. That leaves a grid of open avenues every four tiles with random 3×3
pockets between them, and no possible way to seal a region off. The pockets are
filled with roughly 42 % empty, 38 % brick, 7 % steel, 7 % water, 6 % forest;
steel gets slightly more common as the level number climbs.

Reserved cells override generation:

- the base at `(9, 19)`, inside a fortress (below);
- player spawn `(6, 19)` and the cell above it;
- enemy spawns `(0, 0)`, `(9, 0)`, `(19, 0)` and the cell below each.

### The fortress

The base sits at the bottom edge in a nine-cell block:

```
  col   8      9     10
row 17  brick  brick brick
row 18  brick  brick brick
row 19  steel  BASE  steel
```

Two decisions here came out of watching a bot play, and both matter more than
they look:

- **The base's own row is steel.** Otherwise a shot fired sideways along the
  bottom lane — including one of your own — breaks the single brick beside the
  base and the next one ends the run. The base can now only be reached from
  above: one approach to watch instead of three.
- **The brick above is two layers deep.** With a single layer, an enemy
  anywhere in column 9 could kill the base with two shots from most of the way
  across the board, often before the player had seen it. Three shots is enough
  warning to drive over and intercept.

You can still destroy your own base by standing above it and firing three times
into your own wall. That hazard is part of the original game and is kept.

## Mechanics

### Driving

Tanks store a pixel position and a facing. Movement is axis-locked: a tank only
ever travels along the axis it faces.

- **Wall contact snaps flush.** When a step would collide, the tank is pushed to
  the exact tile boundary in its direction of travel instead of stopping a
  fraction of a pixel short. Walls always feel solid, never sticky.
- **Turning snaps to the grid.** Turning onto the perpendicular axis rounds the
  off-axis coordinate to the nearest tile. This is what makes one-tile corridors
  usable — you don't have to be pixel-perfect to take a turn. The snap is always
  safe: a tank mid-move between two cells legally occupies both of them.
- Tanks block each other; the base, brick, steel and water block tanks; forest
  and empty do not.

### Shooting

One bullet in flight at a time — the classic constraint, and the reason
positioning matters more than trigger speed. A `star` power-up raises that to
two and makes them faster.

Bullets advance in sub-steps of at most half a tile per iteration, so no bullet
can ever skip over a wall at high speed or with a large `dt`. Each sub-step
resolves, in order: out-of-bounds, the tile under the bullet's centre, tanks,
and finally opposing bullets (which cancel each other out — a well-timed shot
deletes an incoming one).

Enemy bullets pass harmlessly through other enemies, so the wave never kills
itself for you.

### Enemies

| Type | Speed | HP | Points | Trait |
|---|---|---|---|---|
| basic | 70 | 1 | 100 | |
| fast | 128 | 1 | 200 | outruns you |
| power | 78 | 1 | 300 | much faster bullets |
| armor | 68 | 4 | 400 | four hits, changes colour as it takes damage |

Up to four are alive at once; the rest queue up and trickle in from the three
top spawn points. Each level's roster is `10 + (level − 1) × 2` tanks, mixed
harder as levels climb.

The AI re-picks a direction on a randomised timer and whenever it runs into
something. Roughly half its decisions are goal-directed — mostly hunting the
player, and about a third of the time pushing for the base — taking the free
direction that closes the gap. The rest are a random legal direction, which is
what stops a tank from grinding against a wall forever. It fires on its own
timer, every 1–2.6 s.

Those weights are the difficulty dial, and they were set by measurement rather
than taste: with enemies steering at the base 70 % of the time, a wave swarmed
the fortress in well under the time it takes to clear it, no matter how the
player defended.

Every fourth tank spawned is a **bonus** tank and flashes; destroying it drops a
power-up somewhere on the map.

### Power-ups

Drive over one to collect it — each is worth 500 points on top of its effect.
They expire after 15 seconds.

| Power-up | Effect |
|---|---|
| `star` | +1 firepower, to a maximum of 3: two bullets in flight, faster, and at 3 they break steel |
| `shield` | 10 seconds of invulnerability |
| `bomb` | destroys every enemy currently on screen, scoring each |
| `life` | one extra life |
| `shovel` | the base's six brick fortress tiles turn to steel for 15 seconds |

Dying resets firepower to 1 and grants 3 seconds of respawn shield, so you never
materialise straight into a bullet.

### Losing and winning

- Enemy bullet hits you → lose a life, respawn after a beat with a shield.
  Out of lives → **GAME OVER**.
- Anything hits the base → immediate **BASE DESTROYED**, game over. This is why
  the shovel is the most valuable drop in the game.
- Wave cleared → **LEVEL CLEAR** for a couple of seconds (press Space to skip),
  then a fresh maze with one more pair of tanks in it.

Best score is kept in `localStorage` under `tankbattle-best`.

## Controls

| Input | Action |
|---|---|
| `←` `→` `↑` `↓` / `W` `A` `S` `D` | drive |
| `Space` | fire (also starts the game when idle or after game over) |
| `Enter` | start / restart |
| `P` | pause / resume |

Holding several direction keys uses the most recently pressed one, so rolling
from one key to the next turns cleanly without a dead frame.

## Code layout

| File | Contents |
|---|---|
| `index.html` | canvas, HUD, overlay, help strip |
| `style.css` | the repo's standard dark arcade panel, tinted olive/steel |
| `game.js` | one classic script — no modules, no build step |
| `tests/tankbattle.spec.js` | Playwright specs |

`game.js` is organised as: constants → RNG → level generation → tank/bullet
helpers → `step(dt)` → `draw()` → input → init. All state lives in top-level
`let` bindings, which makes it directly reachable from `page.evaluate` in the
specs — the same convention the other games in this repo use.

### Testability

`step(dt)` is the whole simulation and is pure with respect to wall-clock time:
it takes its own `dt`, and animation phase is accumulated inside it rather than
read from `Date.now()`. Drawing is a separate `draw()`. That split is what lets
a spec advance the world exactly 120 frames and assert on the result.

Three hooks exist purely for the specs:

- `autoLoop` — set to `false` to stop the `requestAnimationFrame` loop from
  stepping the simulation, so nothing moves except when a spec says so. `draw()`
  keeps running, so a paused-for-testing page still renders.
- `spawnEnabled` — set to `false` to switch off the enemy spawner during long
  deterministic simulations.
- `startGame(seed)` — a fixed seed pins the maze and every AI decision.

Everything else the specs touch (`state`, `grid`, `player`, `enemies`,
`bullets`, `powerups`, `fireBullet`, `spawnEnemy`, `spawnPowerup`, `setTile`,
`placeTank`, …) is ordinary game code, not a test-only affordance.

## Assumptions

These were the ambiguous points; in each case the simpler reading was taken and
recorded here rather than escalated.

1. **Branch name.** The task asked for a branch named after the game
   (`tank-battle`), but this session's standing instructions designate
   `claude/loving-euler-a13e6g` and forbid pushing anywhere else. The designated
   branch wins; the game name lives in the folder, the commits and the PR title.
2. **Single player only.** The original arcade game had a two-player co-op mode.
   One tank, keyboard-driven, matches every other game in this repo.
3. **Whole-tile bricks.** The arcade original splits each brick into four
   quarter-blocks that chip away individually. Here a bullet takes the whole
   tile. It keeps collision, rendering and the specs about a tenth the size, and
   plays nearly the same.
4. **Tank is one tile.** The original's tanks are 2×2 tiles on a half-tile
   movement grid. A one-tile tank on a one-tile grid gives identical
   maze-threading tactics with far simpler collision.
5. **Procedural levels.** No hand-authored stage list — seeded generation with
   guaranteed-connected lanes gives endless levels and a reproducible maze for
   any given seed.
6. **Enemy bullets pass through enemies.** Otherwise the wave grinds itself down
   without the player, which reads as a bug even though it is "realistic".
7. **No sound.** Consistent with the rest of the repo.
8. **Scoring.** Enemy points by type as tabled above, 500 per power-up, and a
   `200 × level` bonus for clearing a wave. No arcade-accurate bonus table
   exists to match, so these were chosen to make hunting the harder tanks worth
   the risk.
