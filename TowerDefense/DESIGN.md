# Tower Defense — Design

## Concept

Creeps march along a fixed serpentine road from the west edge of the map to the
east edge. The player spends gold on towers planted on the grass beside the
road; the towers shoot the creeps as they walk past. Every creep that survives
the walk costs lives. Survive all 20 waves and you win; lose all 20 lives and
the run ends.

It is the one big arcade/strategy genre the repo did not have yet: everything
else is either a direct-control action game or a turn-based board/puzzle game.
Tower Defense is *indirect* control — the player never moves a unit, they only
shape the battlefield and then watch the simulation resolve.

## Board

- Canvas is `640 × 480`, a `20 × 15` grid of `32 px` tiles.
- The road is defined by a waypoint polyline (tile coordinates):
  `(-1,2) → (16,2) → (16,7) → (3,7) → (3,12) → (20,12)`.
  It enters off-screen left and exits off-screen right, so creeps fade in and
  out at the map edge rather than popping into existence mid-map.
- Every tile the polyline passes through is *road* and cannot be built on.
  Everything else is *grass* and can hold one tower.
- Creeps are positioned by a single scalar `dist` — how far along the polyline
  they have walked. `pathPointAt(dist)` converts that back to pixels. Movement
  is therefore exactly `dist += speed * dt`, which keeps the simulation
  deterministic and trivially testable, and makes "which creep is furthest
  along?" (the targeting rule) a plain numeric comparison.

## Towers

| Tower | Key | Cost | Range | Damage | Rate | Special |
|---|---|---|---|---|---|---|
| Arrow | `1` | 50 | 96 px | 8 | 1.4/s | cheap, fast single-target |
| Frost | `2` | 75 | 88 px | 4 | 1.0/s | slows the target 45% for 1.5 s |
| Cannon | `3` | 100 | 112 px | 26 | 0.55/s | 44 px splash on impact |

- Towers target the enemy **furthest along the path** that is inside range —
  the classic "first" targeting rule, and the one that best rewards placing
  towers early on the route.
- Shots are travelling projectiles, not hitscan, so fast creeps can outrun a
  slow cannon shell. A projectile whose target dies in flight fizzles, except
  the cannon shell, which still explodes where the target was.
- **Upgrades:** a tower can be upgraded twice (levels 1 → 3). Each upgrade
  costs `round(cost * 0.8 * level)`, multiplies damage by 1.5 and range by
  1.12.
- **Selling** refunds 60% of everything invested in that tower (rounded down).

## Enemies

| Type | HP | Speed | Bounty | Lives lost if it escapes |
|---|---|---|---|---|
| Grunt | 30 | 42 px/s | 8 | 1 |
| Runner | 18 | 78 px/s | 6 | 1 |
| Tank | 120 | 26 px/s | 20 | 2 |
| Boss | 450 | 30 px/s | 100 | 5 |

Wave `n` (1-based) spawns `6 + 2n` creeps: grunts, with runners mixed in from
wave 3 and tanks from wave 5, plus a boss on every fifth wave. Enemy HP scales
by `1 + 0.25 * (n - 1)`. There is no randomness anywhere in the game — the
whole wave table is a pure function of the wave number, so a given sequence of
player actions always produces the same run.

## Economy and flow

- Start with **150 gold** and **20 lives**; 20 waves total.
- Gold comes from kills (the creep's bounty) and a `20 + 5n` bonus for clearing
  wave `n`. Score tracks the same events, and the best score is kept in
  `localStorage` under `towerDefenseBest`.
- Between waves there is an 8-second countdown; `Space` calls the next wave in
  early. Waves therefore always keep coming — an idle player still advances.
- Lives hit 0 → `gameover`. Wave 20 cleared → `victory`.

## Controls

| Input | Action |
|---|---|
| `1` / `2` / `3` | pick Arrow / Frost / Cannon as the build tool |
| Click grass | build the selected tower there (if affordable) |
| Click a tower | select it — shows its range ring, upgrade and sell prices |
| `U` | upgrade the selected tower |
| `S` | sell the selected tower |
| `Esc` | clear the selection |
| `Space` | start the game, or call the next wave in early |
| `P` | pause / resume |

Mouse hover previews the tower footprint and range ring, tinted red when the
tile is not buildable or the tower is unaffordable.

## Code structure

Single classic (non-module) script, matching Snake, Tetris, Kaboom! and
BurgerTime in this repo, so the Playwright specs can reach state as plain
globals.

- `game.js`
  - **Constants** — grid, path, `TOWER_TYPES`, `ENEMY_TYPES`, wave table.
  - **Path helpers** — `pathPointAt(dist)`, `isRoad(col,row)`,
    `isBuildable(col,row)`, `towerAt(col,row)`.
  - **Lifecycle** — `startGame()`, `startWave()`, `endWave()`, `gameOver()`,
    `win()`.
  - **Actions** — `placeTower(col,row,type)`, `upgradeTower(t)`,
    `sellTower(t)`; each returns a boolean so both the UI and the tests can
    check whether the action was legal.
  - **Simulation** — `step(dt)` advances spawning, enemies, towers and
    projectiles by `dt` seconds. `requestAnimationFrame` only ever converts
    wall-clock into a `dt` and calls `step`, so tests drive the exact same code
    path frame-by-frame without depending on real time.
  - **Render** — `draw()` paints grass, road, towers, creeps with HP bars,
    projectiles, and the hover/selection overlay.

## Assumptions

These were the ambiguous points; in each case the simpler reading was taken and
is recorded here.

1. **Branch name.** The task asks for a branch named after the game
   (`tower-defense`), but this session is bound to the designated branch
   `claude/loving-euler-hf3jyn` and is not permitted to push elsewhere. Work is
   therefore committed on the designated branch; the game name lives in the
   folder, commit message and PR title instead.
2. **One path, one map.** No maze-building or path-selection: a single fixed
   route for all 20 waves. Multi-path or player-drawn mazes would need
   pathfinding and a "don't fully block the road" rule, which is a much larger
   game.
3. **No randomness.** Wave composition, enemy stats and tower behaviour are all
   pure functions of the wave number. This keeps the specs deterministic and
   the game fair to read.
4. **Waves auto-start** after a countdown rather than waiting for the player,
   so the game always progresses; `Space` is a convenience, not a requirement.
5. **Selling refunds 60%,** including gold spent on upgrades, so selling is
   always a mild loss and never an exploit.
6. **Lives, not health.** Leaks cost 1–5 lives depending on creep size instead
   of scaling damage with remaining HP.
7. **Fixed 20 waves** with a victory screen rather than an endless mode, so a
   run has an ending.
8. **Game browser entry** is added to `game-browser/src/assets/games.json`
   under the existing `Strategy` category. The browser's own e2e spec asserts a
   hard-coded card count that was already stale before this change (105
   asserted vs 108 entries), so that assertion is left untouched rather than
   partially fixed here.
