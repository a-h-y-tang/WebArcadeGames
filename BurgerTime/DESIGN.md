# BurgerTime — Design

How the code works, what the rules are, and which assumptions were made while
building it.

## Concept

A platform-and-ladder arcade game in the spirit of Data East's 1982 *BurgerTime*.
You play **Chef Pepper**, running around a scaffold of floors and ladders that is
draped with the parts of four giant hamburgers. Walking the full length of an
ingredient knocks it down one floor; keep knocking pieces down until every
ingredient has landed on the plates at the bottom of the screen and the level is
cleared.

The scaffold is patrolled by walking food — hot dogs, fried eggs and pickles —
that home in on the chef. A touch costs a life. The chef's only weapon is a
finite supply of **pepper**, which freezes anything caught in the cloud for a few
seconds. Dropping an ingredient onto an enemy squashes it outright and makes the
ingredient fall an extra floor, which is where the big scores come from.

There is no other game in this repo built around floors + ladders + falling
scenery, so BurgerTime fills a genuine gap next to the shooters, puzzlers and
board games already here.

## Board geometry

Everything is laid out on a tile grid, so all the level data is just integers.

| Constant | Value | Meaning |
|---|---|---|
| `TILE` | 36 | pixel size of one grid cell |
| `COLS` × `ROWS` | 16 × 14 | grid size → canvas is **576 × 504** |
| `FLOOR_ROWS` | `[1, 4, 7, 10, 13]` | rows that carry a walkable floor beam |
| `PLATE_ROW` | 13 | the bottom floor, which holds the four plates |
| `LANES` | `[1, 5, 9, 13]` | left column of each of the four burger lanes |
| `LANE_TILES` | 3 | width of a lane → each ingredient is 108 px wide |
| `SEGMENTS_PER_ING` | 3 | one segment per tile of the ingredient |

`floorY(row)` returns `row * TILE` — the y of the walking surface. Actors are
positioned by **centre-x / feet-y**, so an actor standing on row `r` has
`y === floorY(r)`.

Ladders are stored as `{ col, top, bottom }` spans covering the floor rows from
`top` to `bottom` inclusive:

```
full-height:  col 0, 4, 8, 12   rows 1 → 13
partial:      col 2  rows 4 → 7      col 6  rows 7 → 10
              col 10 rows 1 → 4      col 14 rows 10 → 13
```

The partial ladders at columns 2, 6, 10 and 14 pass *through* burger lanes,
exactly as they do in the arcade original — this is what makes routing around
the board interesting rather than a straight left/right shuffle.

## Movement model

One routine, `stepActor(actor, dt, speed)`, drives the chef and every enemy, so
they obey identical rules:

- **Vertical intent wins.** If the actor's x is within half a tile of a ladder
  column *and* a ladder span covers its current y in the requested direction, the
  actor snaps to the ladder's centre line and climbs. It is clamped to
  `floorY(span.top) … floorY(span.bottom)`, so you cannot climb off either end.
- **Horizontal movement needs a floor.** `floorRowAt(y)` returns a floor row when
  the actor is within `FLOOR_SNAP` (6 px) of it, otherwise `null`. Walking is
  only allowed when it returns a row, and the actor's y is snapped to that row
  first. That 6 px of slack is what lets a player step off a ladder onto a floor
  without pixel-perfect timing; mid-ladder the chef genuinely cannot walk.

`moveChef(dx, dy)` only records intent — nothing moves until `step(dt)` runs.

## Ingredients

Each ingredient is `{ lane, kind, row, y, segments[3], falling, onPlate }`.
Each lane starts with four pieces stacked down the board:

| Floor row | Kind |
|---|---|
| 1 | `bun-top` |
| 4 | `lettuce` |
| 7 | `patty` |
| 10 | `bun-bottom` |

Because the bottom bun is nearest the plate it lands first, so the burger
assembles itself in the right order without any extra bookkeeping.

**Pressing.** On every frame the chef is standing on an ingredient's floor row
and inside segment *i*'s x-range, that segment is marked pressed. When all three
are pressed the ingredient starts falling. Segments are cleared when it lands.

**Falling** (`stepIngredient`) walks the ingredient down toward the next floor
row below. On arrival:

1. If it still owes `extraFalls` (earned by squashing enemies) it keeps going.
2. Otherwise, if another resting ingredient is on that row in the same lane, that
   one starts falling **and** this one continues — the classic cascade, which is
   how a single well-timed drop can clear half a lane.
3. On `PLATE_ROW` it stops on top of the lane's stack (`PLATE_STACK` = 8 px per
   piece) and is marked `onPlate`.
4. Every landing scores `DROP_POINTS` (50).

**Squashing.** While falling, any un-squashed enemy overlapping the ingredient is
removed. Each one adds `+1` to `extraFalls` and scores `100 × n` where *n* is how
many that single drop has claimed so far, so chaining is worth chasing.

When all 16 ingredients are `onPlate`, `completeLevel()` awards `LEVEL_BONUS`
(1000), bumps `level`, grants one extra pepper and rebuilds the board.

## Enemies

`enemyDecide(e)` is a pure chase heuristic with **no randomness**, which is what
makes the Playwright tests reproducible:

- Mid-ladder (no floor row under the actor) → keep climbing the way it was going.
- On a floor, chef on a *different* floor → climb here if this column's ladder
  goes the right way, otherwise walk toward the nearest column whose ladder does.
- On a floor, chef on the *same* floor → walk straight at the chef.

Enemies spawn on a timer (`FIRST_SPAWN_DELAY` 3 s, then `SPAWN_INTERVAL` 6 s)
from a fixed, cycling list of four corners — again deterministic. At most
`min(5, 2 + level)` are alive at once, and `enemySpeed()` rises with the level
while the chef's speed never changes.

Touching a live (un-stunned) enemy calls `loseLife()`: the board keeps its
ingredient progress, but the chef and all enemies are reset to their starting
spots. At zero lives, `endGame()`.

## Pepper

`throwPepper()` costs one pepper and puts a short-lived cloud one tile in front
of the chef. Any enemy within `PEPPER_RADIUS` gets `stun = PEPPER_STUN` (3 s);
stunned enemies neither move nor hurt the chef. You start with `START_PEPPER`
(5) and earn one per level, so pepper is a real resource, not a get-out clause.

## Controls

| Key | Action |
|---|---|
| ← / → / A / D | Walk (only while on a floor) |
| ↑ / ↓ / W / S | Climb (only while on a ladder) |
| Space | Throw pepper — or start the game when idle / after game over |
| P | Pause / resume |
| Click **Start** | Start or resume |

## Code layout

`game.js` is a single classic (non-module) script, matching Kaboom, Snake and
Tetris in this repo. Top-level `let`/`const` bindings are therefore reachable
from `page.evaluate()` as bare globals, which is how the tests inspect state.

All motion is expressed per second and advanced by `step(dt)`. The
`requestAnimationFrame` loop is nothing more than a caller of `step`, so tests
simulate frames directly (`for (let i = 0; i < 60; i++) step(0.016)`) and never
depend on wall-clock timing.

Test-facing entry points: `startGame`, `step`, `togglePause`, `endGame`,
`updateHud`, `moveChef`, `setChefTile`, `throwPepper`, `spawnEnemy`,
`dropIngredient`, `loseLife`, `completeLevel`, plus the geometry helpers
`floorY`, `colCenter`, `isLadder`, `floorRowAt`, `nextFloorRowBelow` and
`enemySpeed`. Mutable state (`state`, `score`, `lives`, `level`, `pepper`,
`best`, `spawnTimer`, `chef`, `enemies`, `ingredients`, `clouds`, `banner`) is
exposed for assertions and for setting up scenarios. Tests that need a quiet
board set `enemies.length = 0; spawnTimer = 999;`.

The best score persists in `localStorage` under `burgertime-best`.

## Assumptions

Decisions taken without a human to ask; the simpler reading was chosen each time.

- **Branch name.** The task asked for a branch named after the game
  (`burger-time`). The session's standing instructions pin all development and
  pushes to `claude/loving-euler-defpzt` and forbid pushing elsewhere, so the
  work lives on that branch instead. The folder, title and PR still carry the
  game's name.
- **One layout for every level.** Later levels reuse the same scaffold and
  ingredient placement; difficulty comes from faster, more numerous enemies
  rather than new maps. Hand-authoring extra maps adds content, not mechanics.
- **The chef does not ride a falling ingredient.** In the arcade game the chef
  drops with a piece he is standing on. Here he stays on the floor. Riding
  interacts awkwardly with the "walking needs a floor row" rule and would buy
  little.
- **Enemies do not ride falling ingredients either** — they are simply squashed
  and removed. No enemy is knocked to a lower floor and revived.
- **Three segments per ingredient**, not the arcade's four, because a lane is
  three tiles wide. Fewer segments means a slightly faster press.
- **Chase AI is deterministic.** No random wandering, so enemies are predictable
  and every test is reproducible. Pepper and cascades supply the difficulty.
- **Deaths keep ingredient progress.** Only positions reset, so a death is a
  setback rather than a restart of the level.
- **`Space` is overloaded**: it starts the game from the idle / game-over screen
  and throws pepper while running. Nothing else needed that key.
- **Level completion does not pause.** A transient on-canvas banner is shown and
  play continues immediately, which keeps `state` to the four values
  `idle | running | paused | over` and keeps the tests simple.
