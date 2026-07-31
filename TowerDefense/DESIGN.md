# Tower Defense — Design

## Concept

A single-screen, grid-based tower defense game on an HTML5 canvas. Waves of
creeps walk a fixed, winding path from the left edge of the map to the right
edge. The player spends gold to build towers on the grass tiles beside the
path; towers automatically acquire and shoot creeps that come into range. Every
creep that reaches the exit costs a life. Survive all 10 waves to win; lose all
20 lives and the game is over.

The game is deliberately deterministic — there is no randomness anywhere in the
simulation — so both the player and the Playwright tests get reproducible
results from the same inputs.

## Board

- Canvas is 640 × 480, a 20 × 15 grid of 32 px cells.
- The creep path is derived from a fixed list of axis-aligned waypoints:

  ```
  (-1,2) → (4,2) → (4,6) → (10,6) → (10,2) → (15,2) → (15,10) → (6,10) → (6,13) → (20,13)
  ```

  Waypoints are grid coordinates `(col,row)`; the first and last sit just off
  the map so creeps walk in from the left edge and out through the right edge.
- Every cell the path crosses is a road tile. Road tiles cannot be built on;
  every other in-bounds cell can hold exactly one tower.

## Towers

| Tower  | Key | Cost | Range (cells) | Damage | Cooldown | Special             |
|--------|-----|------|---------------|--------|----------|---------------------|
| Arrow  | 1   | 20   | 2.6           | 6      | 0.50 s   | fast single target  |
| Cannon | 2   | 45   | 2.2           | 14     | 1.60 s   | 1-cell splash       |
| Frost  | 3   | 35   | 2.4           | 3      | 0.90 s   | slows target to 45% for 1.5 s |

- Towers target the creep in range that is **furthest along the path** (the one
  closest to leaking), which is the standard and most useful default.
- Shots are travelling projectiles (420 px/s) that home on their target. If the
  target dies in flight the projectile is discarded, except cannon shells, which
  still explode at the target's last known position.
- Clicking an existing tower upgrades it. Levels go 1 → 3; each upgrade costs
  the tower's base cost, multiplies damage by 1.6 and adds 0.3 cells of range.
- Slow effects do not stack; a fresh frost hit refreshes the timer.

## Creeps

- Wave `w` sends `4 + 2w` creeps, spawned 0.7 s apart.
- HP is `round(18 · 1.32^(w-1))`, speed is `1.5 + 0.05(w-1)` cells/s, and each
  creep is worth `3 + w` gold and the same in score.
- Waves 5 and 10 also spawn a boss at the end of the wave: 8× HP, 0.6× speed,
  10× bounty, and it costs 5 lives if it leaks (a normal creep costs 1).

## Economy and flow

- Start with 100 gold, 20 lives, wave 1 of 10.
- `idle` → press Space / Start ⇒ `running` with `waveActive = false`. In that
  build phase the player places towers, then presses Space (or *Send Wave*) to
  release the wave.
- A wave is cleared when the spawn queue is empty and no creeps remain. Clearing
  pays a `20 + 5·wave` bonus and returns to the build phase for the next wave.
- Clearing wave 10 ⇒ `won`. Lives reaching 0 ⇒ `over`. `P` toggles `paused`.
- Score = bounty from kills + wave-clear bonuses + a 25/life survival bonus on
  a win. The best score is kept in `localStorage` under `tower-defense-best`.

## Controls

| Input                 | Action                                        |
|-----------------------|-----------------------------------------------|
| `Space`               | start game / send next wave / play again      |
| `1` `2` `3`           | select Arrow / Cannon / Frost tower           |
| Left click on grass   | build the selected tower                      |
| Left click on a tower | upgrade it (up to level 3)                    |
| `P`                   | pause / resume                                |
| `R`                   | restart                                       |
| Mouse move            | highlight the hovered cell with a range preview |

## Code structure

Written as one classic (non-module) script, like the other games in this repo,
so the tests can reach state and helpers as plain globals.

- `game.js`
  - **Geometry**: `WAYPOINTS`, `buildPath()` (waypoints → pixel polyline plus the
    set of road cells), `isOnPath`, `isBuildable`, `towerAt`.
  - **Towers**: `TOWER_TYPES` table, `placeTower(col,row,type)`,
    `upgradeTower(col,row)`, `towerDamage`/`towerRange` (level-aware).
  - **Creeps**: `spawnCreep(opts)`, `advanceCreep`, `damageCreep`, `killCreep`,
    `leakCreep`.
  - **Simulation**: `step(dt)` — spawn queue, creep movement, tower firing,
    projectile travel, wave completion. `step` is the single entry point used by
    both `requestAnimationFrame` and the tests, and it is sub-stepped at 1/120 s
    so results do not depend on frame rate.
  - **Flow**: `startGame`, `startWave`, `completeWave`, `winGame`, `endGame`,
    `togglePause`.
  - **Rendering**: `draw()` paints grass, road, towers, creeps with HP bars,
    projectiles and the hover preview. Rendering never mutates game state.

## Assumptions

These are the judgement calls made while building this without further input;
the simpler reading was taken each time.

1. **Branch name.** The task asked for a branch named after the game
   (`tower-defense`), but this session is pinned to the pre-assigned branch
   `claude/loving-euler-g8nlm0`, which is the one it is allowed to push. Work was
   done there rather than on a second branch.
2. **One fixed map.** No map editor, no procedural layouts, no maze-building
   (towers never block the path), so pathfinding is a static waypoint list
   instead of a per-frame A*.
3. **Three tower types, three levels.** Enough variety to make choices matter
   without a full upgrade tree. No tower selling — an upgrade is the only thing
   clicking a built tower does.
4. **Fixed 10-wave campaign** with a definite win state, rather than an endless
   survival mode, so "polished and complete" has a clear meaning.
5. **Deterministic simulation.** No RNG in spawning, targeting or damage; wave
   composition is a pure function of the wave number. Only decorative hit
   particles use `Math.random`, and they are never read by game logic.
6. **Targeting rule.** "Furthest along the path" is used rather than nearest or
   lowest-HP, and it is not player-configurable.
7. **Damage is applied on projectile impact**, not at the moment of firing, so
   overkill is possible; this is normal for the genre and keeps the visuals
   honest.
8. **Score, not wave, is the persisted "best"**, matching the other arcade games
   in this repo which store a single best score in `localStorage`.
