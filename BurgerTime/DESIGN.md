# BurgerTime — Design

## Game concept

A single-screen platform/ladder arcade game. You play Chef Peter Pepper, running
across a lattice of girder floors joined by ladders. Four burgers hang in pieces
above four plates; walking the full length of an ingredient makes it drop one
floor, and the goal is to walk every ingredient of every burger all the way down
onto its plate.

Roaming food enemies (hot dogs, eggs and pickles) chase the chef. Touching one
costs a life. The chef fights back two ways: dropping an ingredient on an enemy
squashes it, and a limited supply of pepper stuns anything caught in the cloud.

Clearing all four burgers advances to the next level, where enemies are faster
and spawn more often. The pepper supply is refilled each level.

## World model

The board is a graph of horizontal **floors** and vertical **ladders**, all
expressed in canvas pixels rather than a tile grid.

| Constant | Value | Meaning |
|---|---|---|
| `CANVAS_W` × `CANVAS_H` | 640 × 480 | Playfield size |
| `FLOOR_YS` | `[80, 150, 220, 290, 360, 430]` | y of each walkable girder |
| `PLATE_FLOOR` | `5` | Bottom floor — the plates live here |
| `LADDER_XS` | `[16, 160, 320, 480, 624]` | x of each ladder (all span every floor) |
| `BURGER_XS` | `[32, 192, 352, 512]` | Left edge of each burger column |
| `SEG_W` / `SEGS` | 24 / 4 | Ingredients are 4 segments wide (96 px) |
| `PLAY_LEFT` / `PLAY_RIGHT` | 12 / 628 | Horizontal limits of the chef |

Every moving thing (chef and enemies) is an *entity* with the same shape:

```js
{ x, y, floor, ladder, dirX, dirY, facing }
```

`floor` is the index of the girder the entity is standing on, or `null` while it
is between floors. `ladder` is the index of the ladder it is attached to, or
`null`. Both the chef and the enemies are moved by the same `moveEntity()`
routine, so enemies can never do something the player cannot:

1. If there is vertical intent and the entity is standing on a floor within
   `LADDER_SNAP` (12 px) of a ladder that continues in that direction, it snaps
   to the ladder's x and mounts it.
2. While on a ladder, vertical intent moves it along the ladder, clamped to the
   ladder's extent. Reaching the top or bottom dismounts it onto that floor.
3. Horizontal intent only applies when the entity is standing on a floor; it
   dismounts from a ladder and snaps y to the girder.

`floorAtY(y)` maps a y coordinate back to a floor index with a 4 px tolerance,
which is what lets an entity climbing past a girder briefly count as standing on
it.

## Ingredients

Each of the 16 ingredients (4 burgers × 4 pieces) is:

```js
{ burger, kind, x, floor, y, segs: [false, false, false, false], falling, landed, stack }
```

**Stepping.** On every simulation sub-step, if the chef is standing on the same
floor as a resting ingredient and horizontally inside it, the segment under the
chef is marked stepped. Stepped segments are drawn pressed down.

**Dropping.** When all four segments are stepped the ingredient starts falling
(`startFall`), scoring `DROP_POINTS`. It descends at `FALL_SPEED` toward the next
floor down.

**Chaining.** On arrival, if another ingredient of the same burger is resting on
that floor, both are launched onward to the floor below — the classic cascade.
Otherwise the ingredient comes to rest and its segments reset, so it has to be
walked again.

**Plating.** Reaching `PLATE_FLOOR` marks the ingredient `landed`; it takes a
`stack` index so the pieces pile up visually on the plate. Completing all four
pieces of one burger awards `BURGER_POINTS`; completing all four burgers calls
`completeLevel()`.

**Squashing.** A falling ingredient that overlaps an enemy removes it and scores
`SQUASH_POINTS`.

## Enemies

Enemies re-decide their direction whenever they are standing on a floor:

- Same floor as the chef → walk straight at them.
- Different floor → pick the nearest ladder that continues toward the chef's
  floor; walk to it, then climb.

Mid-climb they keep their current vertical direction, so they commit to a ladder
rather than jittering. A stunned enemy (`stun > 0`) holds still. Enemy speed is
`ENEMY_BASE + (level - 1) * ENEMY_STEP`, always below the chef's speed so the
game stays winnable.

Touching the chef costs a life: the board keeps its ingredient progress, but the
chef returns to the start and every enemy is cleared.

## Pepper

`usePepper()` spends one pepper and puts a short-lived cloud in front of the
chef. Any enemy within `PEPPER_RADIUS` of the cloud is stunned for
`PEPPER_STUN` seconds. Peppers refill on each new level.

## Simulation

All motion is per-second and advanced through `step(dt)`, which runs fixed
`1/240 s` sub-steps so fast-falling ingredients can never tunnel past an enemy or
a floor. The real-time `requestAnimationFrame` loop calls the same `step()` the
Playwright tests call, so tests simulate frames deterministically without
depending on wall-clock timing. Everything is a plain global in a classic
(non-module) script, matching Kaboom, Snake and Tetris in this repo, so the tests
can reach the state directly.

## Controls

| Input | Action |
|---|---|
| `←` `→` / `A` `D` | Run along a girder |
| `↑` `↓` / `W` `S` | Climb a ladder |
| `Space` | Throw pepper (also starts / restarts the game) |
| `P` | Pause / resume |

## Scoring

| Event | Points |
|---|---|
| Ingredient dropped one floor | 50 |
| Enemy squashed by an ingredient | 100 |
| Burger completed | 500 |
| Level cleared | 1000 |

Best score persists in `localStorage` under `burgertime-best`.

## Assumptions

These were ambiguous in the brief; the simpler reading was taken each time and
recorded here.

- **Branch name.** The task asked for a branch named after the game
  (`burger-time`), but this session's standing instruction pins development to
  `claude/loving-euler-qoai7o` and forbids pushing elsewhere. The designated
  branch wins; the game folder and browser id carry the `BurgerTime` /
  `burger-time` naming instead.
- **Ladder layout.** Real BurgerTime uses partial ladders that only connect some
  floors. Here every ladder spans the full height. It keeps both the level data
  and the enemy pathfinding simple, and the burger columns still force real
  routing decisions.
- **Enemies riding ingredients.** In the arcade original an enemy standing on an
  ingredient rides it down and can be dropped onto a plate. Here a falling
  ingredient simply squashes anything it touches.
- **Pepper as a stun.** The original freezes enemies for a fixed time; that is
  what is implemented (no "kick the enemy off the board" behaviour).
- **Fixed level layout.** Every level uses the same girder/ladder/burger layout.
  Difficulty scales through enemy speed and spawn rate rather than new maps.
- **One enemy type behaviourally.** The three enemy sprites differ only in
  colour and name; they share one chase routine.
- **Player is immune to falling food.** Only enemies are squashed.
