# Tower Defense — design

## Concept

A fixed-road tower defense on an HTML5 canvas. The map is an 18x12 grid of 40px
tiles (720x480). One road crosses it from left to right; creeps walk that road
and the player builds towers on the open ground beside it. Twelve hand-authored
waves escalate from single-file grunts to bosses escorted by tanks and runners.

There is no maze building and no path finding: the road is authored as a list of
waypoints, which keeps both the game and its tests deterministic and simple.

## Mechanics

### The map

`WAYPOINTS` lists the road in tile coordinates, starting off the left edge
(`c: -1`) and ending off the right edge (`c: 18`) so creeps walk on and off
screen. Every leg is axis aligned, so expanding the waypoints into the set of
road tiles (`PATH_TILES`) is a straight walk of one step at a time. A tile is
buildable when it is inside the grid, not a road tile, and not already occupied.

`PATH_PX` is the same road in pixels — that is what creeps actually follow.

### Creeps

Each creep stores its position, the index of the waypoint it is walking toward
(`wp`), and `dist`, the total distance it has covered. `advance(e, travel)`
consumes the travel budget waypoint by waypoint, so a fast creep can cross a
corner inside a single frame without cutting it. Reaching the end of the
waypoint list is a leak: the creep is removed and its `leak` value is subtracted
from the player's lives.

Four types (`ENEMY_TYPES`) trade hp against speed and payout:

| Type | HP | Speed | Reward | Lives lost on leak |
|---|---|---|---|---|
| Grunt | 26 | 55 | 6 | 1 |
| Runner | 15 | 105 | 5 | 1 |
| Tank | 95 | 38 | 16 | 2 |
| Boss | 700 | 30 | 70 | 5 |

HP scales with the wave number: `hp * (1 + (wave - 1) * HP_GROWTH)` with
`HP_GROWTH = 0.5`. Speed and reward do not scale, so late waves are about damage
output, not reflexes.

### Waves

`WAVES` is an array of twelve entries, each a list of groups
(`{ type, count, interval, delay }`). Starting a wave flattens its groups into a
`spawnQueue` of `{ type, at }` entries sorted by time; `updateSpawns` pops
everything whose time has arrived. A wave is complete when the queue and the
field are both empty, which pays a bonus of `12 + wave * 3` gold. Waves never
start on their own — the player presses <kbd>Space</kbd> — so there is no timer
pressure while building.

### Towers

Three types (`TOWER_TYPES`) with cost, range, damage, fire rate and a projectile
speed; Cannon adds `splash`, Frost adds `slow`/`slowTime`. Levels 2 and 3 add
30% damage and 10% range each (`towerDamage`, `towerRange`); the upgrade price is
`floor(baseCost * 0.8 * level)`. Selling refunds `floor(invested * 0.6)`.

Targeting (`acquireTarget`) picks the creep inside the range circle with the
largest `dist` — the one closest to leaking. Shots are homing projectiles rather
than hitscan, so damage lands a beat after the muzzle flash and an over-killed
creep can waste a shell. On impact a projectile either splashes
(`explodeAt`, damaging everything inside the blast radius) or damages its single
target and, for Frost, refreshes that target's `slowT`.

### Economy and the loss condition

Start with 20 lives and 150 gold. Gold comes from kills and wave bonuses; lives
only ever go down. Reaching 0 lives ends the game; clearing wave 12 wins it. The
furthest wave reached is stored in `localStorage` under `tower-defense-best`.

## Code layout

`game.js` is a single classic (non-module) script, matching Slime Volley, Kaboom
and Tetris in this repo: constants, then map helpers, then towers, creeps,
projectiles, waves, match flow, chrome, drawing, the rAF loop and input.

The important structural decision is that **all simulation happens in
`step(dt)`**, and the animation loop is nothing more than
`if (state === 'running') step(dt); draw();`. Tests therefore simulate whole
waves by calling `step(1/60)` in a loop, with no dependence on real time or on
`requestAnimationFrame`. `step(dt, force)` takes an optional second argument that
runs the simulation even when the game is not in the `running` state, which lets
tests exercise movement in isolation.

State lives in script-scoped `let` bindings (`state`, `lives`, `money`, `wave`,
`enemies`, `towers`, `projectiles`, …), so Playwright can read and poke them
directly through `page.evaluate`. Enemy and projectile removal is done in place
with `splice` so references the tests hold stay valid.

Drawing is entirely derived from state — `draw()` is safe to call in any state
and is never a source of truth.

### Test helpers

Three helpers exist mainly so tests can be written against the map without
hard-coding tile coordinates, and they double as real game logic:

- `firstBuildableTile()` — first open tile, scanning column by column.
- `buildableNearPathStart()` — open tile closest to the road 250px in from the
  entrance, i.e. where a first tower naturally goes.
- `farBuildableTile()` — open tile furthest from the entrance, used to assert
  that towers do not shoot beyond their range.

## Testing approach

Written test-first with `@playwright/test`: the 64-test spec in
`tests/tower-defense.spec.js` was committed red, then `index.html`, `style.css`
and `game.js` were written until it went green. Coverage is grouped into page
scaffolding, map invariants (road is axis aligned, road tiles are not buildable,
out-of-grid tiles are not buildable), starting, building rules, upgrade/sell
economics, creep movement (including "a creep never leaves a road tile for the
whole run"), combat (range, targeting priority, splash, slow), wave flow, win and
loss, pause/restart/persistence, and rendering.

Balance was checked with a throwaway autoplay probe that ranks open tiles by how
much road they cover, buys greedily and launches every wave immediately. Tuning
targets that near-optimal bot finishing wave 12 with roughly 15 of 20 lives — a
comfortable win for strong play, so an ordinary player is under real pressure in
the last few waves.

## Assumptions

The task brief left some things open. Where it did, the simpler reading won:

- **Fixed road, not maze building.** Creeps follow authored waypoints. No path
  finding, so towers can never block or trap them.
- **Waves are player-launched.** No countdown between waves, so building is
  never a race against a timer. The canvas prompts for <kbd>Space</kbd>.
- **One map, twelve waves, a definite ending.** A finite campaign is easier to
  balance and to assert on than an endless mode.
- **Single-target towers do not lead their shots.** Projectiles home in on the
  target's current position, so they always connect while the target lives.
- **Damage is applied on impact.** A creep killed by an earlier shot means the
  shell already in flight is wasted (except splash, which still explodes).
- **Towers cannot be moved,** only sold at 60% of what was invested.
- **No sound.** No other game in this repo ships audio.
- **Branching.** The brief asked for a branch named after the game; the session
  is pinned to the branch `claude/loving-euler-cal3kc`, so development happened
  there and that is what is pushed.
- **Game browser counts.** `game-browser/e2e/game-browser.spec.ts` hard-codes the
  number of game cards. It was already stale (105 asserted against 108 entries in
  `games.json`); it is now set to 109, matching `games.json` with Tower Defense
  added. That Angular suite is not part of the root `npm test` run and was not
  executed here.
