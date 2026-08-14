# Tower Defense — Design

## Game concept

A grid-based tower defense game on an HTML5 canvas. Waves of creeps march along a
fixed, winding road from the entrance on the left edge to the exit on the right.
You cannot fight them directly — you spend gold on turrets built on the grass
either side of the road, and the turrets do the shooting for you. Every creep that
survives the whole road costs you lives; every creep that dies pays out gold and
score. Survive all twelve waves with at least one life left and you win.

Nothing else in this repo is a tower defense game: the existing 109 titles are
maze, shooter, platform, puzzle, board and card games, all of which put the player
*inside* the action. Tower Defense is the repo's first "build the machine, then
watch it run" game — the interesting decisions all happen during the quiet build
phase, and the wave is the test of those decisions.

## World geometry

Everything derives from a tile grid, so both the renderer and the tests can reason
about the board in whole cells.

| Constant | Value | Meaning |
|---|---|---|
| `CELL` | 28 px | one grid cell |
| `COLS` | 20 | grid columns (canvas is `COLS * CELL` = 560 px wide) |
| `ROWS` | 15 | grid rows (canvas is `ROWS * CELL` = 420 px tall) |

The road is defined by a list of waypoints in grid coordinates. Consecutive
waypoints always share a row or a column, so the road is a chain of straight
horizontal and vertical runs:

```
(-1, 2) → (14, 2) → (14, 5) → (3, 5) → (3, 8) → (16, 8) → (16, 11) → (6, 11) → (6, 13) → (20, 13)
```

The first and last waypoints sit one cell outside the board, so creeps walk on
from off-screen and walk off the far edge rather than popping into existence in
the middle of the map. Every cell touched by that chain is a **road cell** and
cannot be built on; every other cell is buildable grass. The road doubles back on
itself four times, which is what makes a turret placed in the middle of the map
cover several lanes at once — the core placement decision of the game.

Creeps move along `pathPoints`, the waypoint list converted to pixel centres. A
creep stores the index of the segment it is on plus its distance along that
segment, so its position is always exactly reconstructible from two numbers —
there is no accumulated floating-point drift, and tests can assert on progress
directly.

## Mechanics

### Phases

The game alternates between two phases:

- **Build phase** (`state === 'building'`) — no creeps on the board. Place,
  upgrade and sell turrets with the mouse. Nothing moves.
- **Wave phase** (`state === 'running'`) — creeps spawn from the queue at a fixed
  interval, walk the road, and get shot. The wave ends when the spawn queue is
  empty and no creep is left alive on the board.

Waves are **only** started by the player (`Space`, or the *Send Wave* button).
There is no build-phase countdown timer. This is the deliberately simpler reading
of "waves come at you": it removes a timer from the simulation, makes the whole
build phase deterministic, and means an unattended game can never lose on its own.

### Towers

Three turret types, selected with `1` / `2` / `3` or by clicking the buttons under
the board:

| Type | Cost | Range | Damage | Cooldown | Special |
|---|---|---|---|---|---|
| Gun | 20 | 78 px (≈2.8 cells) | 4 | 0.45 s | fast single-target bullet |
| Frost | 30 | 70 px (2.5 cells) | 1 | 0.90 s | hitscan beam, slows the target to 50 % for 1.8 s |
| Cannon | 45 | 95 px (≈3.4 cells) | 14 | 1.40 s | slow shell, 40 px splash on impact |

A turret picks the target that is **furthest along the road** inside its range —
the standard "first" targeting rule, and the one that best rewards building near
the exit. Gun and cannon fire travelling projectiles; frost applies its effect the
instant it fires, which is why it does almost no damage.

Clicking a turret you already own **upgrades** it, up to level 3. Each level
multiplies damage by 1.5 and range by 1.1, and costs the turret's base cost times
its current level. Right-clicking a turret **sells** it for 60 % of everything
invested in it, so a misplaced turret is a setback rather than a dead run.

### Creeps and waves

| Creep | HP | Speed | Gold | Lives lost on leak | Points |
|---|---|---|---|---|---|
| Grunt | 18 | 60 px/s | 6 | 1 | 10 |
| Runner | 10 | 105 px/s | 5 | 1 | 12 |
| Tank | 70 | 38 px/s | 14 | 2 | 25 |
| Boss | 320 | 42 px/s | 60 | 5 | 100 |

Twelve hand-written waves introduce the types in order: grunts alone, then
runners, then tanks from wave 5, then a boss on wave 12. On top of the table, each
creep's HP is multiplied by `1 + 0.15 * (wave - 1)`, so a wave-12 grunt has about
2.6× the HP of a wave-1 grunt and the same layout keeps getting harder.

Clearing a wave pays an income bonus of `15 + 3 * wave` gold and 25 score, which is
what funds the next round of building.

### Win, loss and scoring

You start with **20 lives** and **100 gold**. Lives only ever go down (leaks), gold
goes up on kills and wave clears. Reaching 0 lives ends the run immediately
(`state === 'over'`); clearing wave 12 with lives remaining wins it
(`state === 'won'`). Score is the sum of kill points plus wave-clear bonuses, and
the best score persists in `localStorage` under `towerdefense-best`.

## Controls

| Input | Action |
|---|---|
| `Left click` on grass | build the selected turret (if affordable) |
| `Left click` on your turret | upgrade it one level (if affordable) |
| `Right click` on your turret | sell it for 60 % of its invested gold |
| `1` `2` `3` | select gun / frost / cannon |
| `Space` | start the game, or send the next wave |
| `P` | pause / resume |
| `R` | restart after a win or a loss |

## Code structure

`game.js` is a single classic script (no modules, no build step) so the page can be
opened straight from the filesystem, matching every other game in this repo. It is
organised as:

1. **Constants** — grid, waypoints, tower table, creep table, wave table.
2. **State** — `state`, `gold`, `lives`, `wave`, `score`, plus the `towers`,
   `creeps` and `projectiles` arrays and the `spawnQueue`.
3. **Board helpers** — `cellCenter`, `isRoad`, `isBuildable`, `towerAt`.
4. **Player actions** — `placeTower`, `upgradeTower`, `sellTower`, `callWave`,
   `startGame`, `togglePause`. Each returns a boolean so both the UI and the tests
   can tell a rejected action (too poor, wrong cell) from an accepted one.
5. **Simulation** — `step(dt)`, split into `stepSpawns`, `stepCreeps`,
   `stepTowers`, `stepProjectiles` and the wave-end check.
6. **Rendering** — `draw()`, called only from the animation frame; `step()` never
   touches the canvas.
7. **Input and init** — keyboard, mouse and button wiring, then the RAF loop.

`step(dt)` is pure simulation and is driven by the tests directly, so the entire
game can be exercised deterministically without waiting on real time.

## Assumptions

These are the judgement calls made where the brief was open-ended; each takes the
simpler reading.

- **Branch name.** The task asked for a branch named after the game
  (`tower-defense`), but this session is required to develop and push on its
  assigned branch `claude/loving-euler-lo3pmj`. The assigned branch wins; the game
  folder is `TowerDefense/` and the game id is `tower-defense`.
- **No build-phase timer.** Waves start only when the player calls them (see
  *Phases*). A timer would add a second clock to the simulation for no extra depth.
- **One fixed map.** A single hand-designed road, not a generated one, so the
  difficulty of every wave is a fixed, testable quantity and the twelve waves can
  be tuned against it.
- **Targeting is "first"** (furthest along the road) for every turret type, rather
  than per-type targeting modes. One rule is easier to read on screen and to reason
  about when placing.
- **No creep pathing choices.** Creeps follow the fixed road and cannot be blocked
  or rerouted by turrets, so there is no maze-building sub-game and no pathfinding.
- **Frost does not stack.** A second frost hit refreshes the slow timer instead of
  compounding the slow factor; slowing a creep to a standstill would trivialise
  the game.
- **Projectiles home.** Bullets and shells track their target rather than firing at
  a predicted point, so a fired shot is never wasted by a target changing speed
  (which frost makes common). A shell whose target dies mid-flight still detonates
  where the target was, keeping splash useful.
- **Lives never regenerate** and there is no leak-proof "final boss room"; the run
  is simply the twelve waves.
- **Screenshot.** `screenshot.png` is captured from the running game by a Playwright
  test run rather than drawn by hand, matching the other games' thumbnails.
