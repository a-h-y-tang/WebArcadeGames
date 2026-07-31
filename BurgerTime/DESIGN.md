# Burger Time — Design

## Concept

Burger Time is a ladders-and-platforms arcade game inspired by the 1982 Data
East cabinet. A chef runs along five steel girders joined by ladders. Three
burgers hang above three plates, each split into a **top bun**, **lettuce**,
**patty** and **bottom bun**. Walking the full width of an ingredient knocks it
down one level; knock every piece all the way to the plate to assemble all three
burgers and clear the level.

Food enemies climb the tower hunting the chef. Touching one costs a chef. A
shake of pepper freezes anything directly in front of you long enough to slip
past, and an ingredient that lands on an enemy squashes it for a fat bonus.

## World geometry

Everything is derived from a 26 px tile on a 20 × 21 tile canvas (520 × 546).

| Element | Value |
|---|---|
| Girder rows | tiles 2, 6, 10, 14, 18 (`FLOOR_ROWS`) |
| Ladder columns | tiles 1, 6, 12, 18 (`LADDER_COLS`) — every ladder spans the whole tower |
| Burger columns | tiles 2, 8, 14 (`BURGER_COLS`), each ingredient 4 tiles wide |
| Plate row | tile 20 |

Helper functions expose the same geometry to the tests: `floorY(i)`,
`ladderX(col)`, `restY(floorIndex)`.

## Mechanics

- **Walking.** The chef only moves horizontally while standing on a girder
  (within `FLOOR_SNAP` = 3 px of it) and is clamped to the canvas edges.
- **Climbing.** Vertical movement needs the chef within `LADDER_SNAP` (half a
  tile) of a ladder centre; climbing snaps x to that centre and clamps y between
  the top and bottom girders.
- **Stepping.** Each ingredient is four segments wide. While the chef stands on
  a segment of an ingredient on the *same* floor, that segment is pressed down.
  When all four segments are pressed the ingredient falls one level and its
  segments reset — the next level has to be walked again.
- **Falling and cascades.** A falling ingredient drops at `FALL_SPEED` toward
  the floor below. If another ingredient is resting where it lands, that one is
  knocked down a level too, which can chain the whole stack down the tower.
- **Plating.** An ingredient knocked off the bottom girder lands on its plate
  and stacks on whatever is already there. Once all 12 ingredients are plated
  the level is complete: `level` increments, a `LEVEL_BONUS` is awarded, one
  pepper shaker is refunded (capped at 5) and a fresh board is built.
- **Enemies.** Enemies walk toward the chef on a shared floor; otherwise they
  head for the ladder that minimises `|enemy → ladder| + |ladder → chef|` and
  climb toward the chef's floor. They spawn on the top floor on a timer that
  shortens with the level, capped at `min(5, 2 + level)` alive at once.
- **Losing a chef.** Contact with an unstunned enemy costs a life, clears the
  board of enemies and grants `RESPAWN_GRACE` quiet seconds. At zero lives the
  game ends and the best score is written to `localStorage`.
- **Pepper.** `firePepper()` spends one shaker and stuns every enemy in a
  `PEPPER_RANGE`-wide box in front of the chef for `STUN_TIME` seconds. Stunned
  enemies neither move nor hurt the chef.
- **Squashing.** Enemies caught under a falling ingredient are removed for
  `SQUASH_POINTS`.

### Difficulty scaling (pure functions of `level`)

| Quantity | Formula |
|---|---|
| `enemySpeed()` | `58 + (level - 1) * 7` |
| `spawnInterval()` | `max(1.8, 5.0 - (level - 1) * 0.45)` |
| max enemies alive | `min(5, 2 + level)` |

### Scoring

| Event | Points |
|---|---|
| Knock an ingredient down a level | 50 |
| Land an ingredient on a plate | 100 |
| Squash an enemy with an ingredient | 500 |
| Clear a level | 1000 |

## Controls

| Input | Action |
|---|---|
| ← / → or A / D | Walk along a girder |
| ↑ / ↓ or W / S | Climb a ladder |
| Space | Throw pepper (or start / restart when not playing) |
| P | Pause / resume |

## Code layout

Single classic script, no build step, mirroring the rest of the repo:

- `index.html` — HUD, canvas, overlay.
- `style.css` — dark arcade panel styling.
- `game.js` — geometry helpers, board setup, chef movement, ingredient physics,
  enemy AI, rendering, HUD and input, all as top-level globals.

`step(dt)` advances one frame of simulation and returns immediately unless the
state is `running`; `draw()` paints. `requestAnimationFrame` only supplies `dt`,
so the Playwright tests drive `step(0.016)` directly for deterministic frames.
Test seams intentionally exposed as globals: `state`, `score`, `best`, `level`,
`lives`, `pepper`, `enemySpawnTimer`, `chef`, `ingredients`, `plates`,
`enemies`, plus `startGame()`, `step()`, `draw()`, `setChefDir()`,
`placeChef()`, `firePepper()`, `spawnEnemy()`, `plateIngredient()`,
`togglePause()`, `loadBest()`, `enemySpeed()`.

## Assumptions

The scheduled task left a few things open; the simpler reading was taken each
time and recorded here.

1. **Branch name.** The task asked for a branch named after the game
   (`burger-time`), but this session is pinned to the designated development
   branch `claude/loving-euler-s2k7e0` and must not push elsewhere. The
   designated branch wins; the game name is carried by the folder, commit and PR
   title instead.
2. **Uniform ladders.** Every ladder column runs the full height of the tower
   rather than the arcade original's irregular partial ladders. It keeps the
   navigation graph trivial and the enemy AI honest.
3. **Presence-based stepping.** A segment is pressed when the chef *stands* on
   it, not by tracking a continuous walk across it. Walking still presses each
   segment in turn, so play is unchanged, and tests can place the chef directly.
4. **Cascades drop one level.** A falling ingredient pushes the ingredient it
   lands on down exactly one level (which may chain). The arcade's rule where a
   squashed enemy adds an extra level of fall is omitted.
5. **No level-clear interlude.** Completing a burger set rebuilds the board
   immediately and keeps the state `running`, instead of playing a jingle or
   showing an interstitial.
6. **Fixed ingredient set.** Four ingredients per burger, three burgers, on a
   five-girder tower for every level; difficulty scales through enemy speed and
   spawn rate only.
7. **Pepper is a stun, not a kill.** Stunned enemies recover after
   `STUN_TIME`; only falling ingredients remove them.
8. **Enemies spawn at the top.** Spawns are always on the top girder at a random
   ladder, which keeps the chef's starting position safe for a few seconds.
