# Tank Battle — Design

## Concept

A Battle City style base-defence shooter on a 13 x 13 tile battlefield. You
command a single tank. Waves of enemy tanks roll in from the three spawn points
along the top edge, and every one of them is looking for the eagle sitting in
the brick fortress at the bottom of the map. Destroy the whole wave to advance a
level. Lose all three tanks, or let one shell through to the eagle, and the
battle is over.

The tension is a two-front problem: the enemy you are chasing is never the enemy
that is about to reach the eagle, and the brick walls that shelter your base are
the same walls that block your shots.

## Mechanics

### Battlefield

- 13 x 13 tiles of 32 px each — a 416 x 416 canvas.
- Terrain types:
  | Tile | Tanks | Shells | Notes |
  |---|---|---|---|
  | Empty | pass | pass | |
  | Brick | block | **destroy the tile** | how you tunnel through the map |
  | Steel | block | block | permanent cover |
  | Water | block | pass | shoot across it, never drive across it |
  | Trees | pass | pass | drawn *over* tanks, so they hide whatever is under them |
  | Eagle | block | **ends the game** | the thing you are defending |
- The eagle sits at column 6, row 12 behind a brick fortress that is two tiles
  deep at the front, so a single lucky shell can never finish the game outright.
- Layouts are generated from a seeded PRNG (mulberry32) keyed off the level
  number, so a level always looks the same — stages are learnable, and the
  Playwright specs get a stable world to assert against.
- Rows 0, 6 and 12 and columns 0, 3, 9 and 12 are *lanes*: they only ever
  contain empty tiles or trees. Because the lanes intersect, and every spawn
  point sits on one, the map is guaranteed to be traversable without a
  post-generation carving pass. The centre column is deliberately excluded — an
  open run from the middle spawn straight down onto the eagle made the first
  wave unsurvivable in playtesting.

### Tanks

- Tanks are 26 px squares that drive along lanes centred on the 32 px grid.
  Turning onto the other axis snaps the tank into the middle of its lane (the
  arcade original does the same); without that you could never line a shot up.
  A snap that would push the tank into a wall is discarded.
- Movement is a slide: the tank travels as far along its heading as the terrain
  allows and finishes flush against whatever stopped it, found by a short binary
  search on the movement distance.
- Enemy varieties, mixed in by level:
  | Type | Speed | Armour | Score |
  |---|---|---|---|
  | Basic | 52 px/s | 1 | 100 |
  | Fast | 84 px/s | 1 | 200 |
  | Armoured | 44 px/s | 2 | 300 |
- At most four enemies are on the field at once; a wave is `8 + 2 * (level - 1)`
  tanks, capped at 20. A new tank deploys every 2.4 s while a slot is free.

### Shells

- One shell in the air per tank. Player shells travel at 300 px/s, enemy shells
  at 230 px/s.
- Shells are advanced in hops of at most 3 px per frame slice, so they cannot
  tunnel through a one-tile wall or past an oncoming shell.
- A player shell and an enemy shell that meet knock each other out of the air.
- Shells do not hurt the tank that fired them, and enemy shells do not hurt
  other enemies.

### Player, lives and scoring

- Three tanks. Getting hit costs a tank and respawns you at the bottom-left
  spawn with a 2.5 s shield; shells that reach a shielded tank are spent
  harmlessly.
- Score is the value of each tank destroyed, and it carries across levels. The
  best score is kept in `localStorage` under `tankbattle-best`.
- Clearing a wave pauses the battle for two seconds, then builds the next level.

## Controls

| Input | Action |
|---|---|
| Arrow keys / WASD | Drive (the tank faces the last direction you held) |
| Space | Fire |
| P | Pause / resume |
| Space (idle or game over) | Start a new battle |
| Start button | Start a new battle, or resume from pause |

## Code layout

- `index.html` — HUD, canvas, overlay, help strip.
- `style.css` — the same dark panel styling the other games in this repo use.
- `game.js` — one classic (non-module) script, so its state is reachable from
  the Playwright specs as plain globals. All motion is per-second and applied
  through `step(dt)`, which the specs call directly.
- `tests/tankbattle.spec.js` — 52 Playwright specs, written before the game.

Two globals exist purely so the specs can own the clock:

- `loopEnabled = false` stops `requestAnimationFrame` from stepping the
  simulation, leaving the specs to call `step(dt)` themselves.
- `spawnEnabled = false` switches off enemy deployment so a spec can place
  exactly the tanks it wants to reason about.

Both default to `true`, so normal play is unaffected.

## Assumptions

These are the ambiguous calls made while building this, resolved towards the
simpler option as instructed:

1. **Branch name.** The task asked for a branch named after the game
   (`tank-battle`), but this session's standing instructions pin all work to
   `claude/loving-euler-qps2w3` and forbid pushing elsewhere. The standing
   instruction wins; the work is committed to the designated branch.
2. **Bricks are whole tiles.** The arcade original splits each brick tile into
   quarters that chip away one at a time. Here a shell destroys the whole
   32 px tile, which keeps collision and rendering simple.
3. **No power-ups.** The original drops shovels, stars, grenades and extra
   lives. This version ships without them; the level curve does the escalating
   instead (more tanks, more armour, more steel).
4. **One player only.** No two-player co-op mode.
5. **Any shell destroys the eagle**, including one of your own — as in the
   original. Shooting your own fortress is a real way to lose.
6. **Fixed layouts per level.** Seeding from the level number rather than the
   clock means level 3 is always the same level 3. This is treated as a
   feature (learnable stages) rather than a limitation.
7. **Enemies do not aim.** They pick a heading — often towards the eagle,
   sometimes towards the player, often at random — and fire on a timer rather
   than doing line-of-sight checks. Deliberate aiming made early waves
   overwhelming in playtesting.
8. **Score values** follow the spirit of the original (100 / 200 / 300 by tank
   type) rather than its exact table.
