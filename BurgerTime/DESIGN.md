# Burger Time — Design

## Concept

**Burger Time** is a single-screen platform/ladder arcade game inspired by the
1982 Data East classic. You play a chef trapped on a lattice of girders and
ladders together with four half-built hamburgers. Walking across a burger
ingredient stamps it down; stamp every segment of an ingredient and it drops to
the girder below, knocking whatever it lands on down a level too. Push all four
ingredients of a stack into the plate at the bottom and the burger is served.

Three food enemies — a hot dog, a fried egg and a pickle — climb the girders
hunting the chef. Contact costs a life. The chef carries a finite supply of
pepper shakers: a puff of pepper stuns anything caught in it for a few seconds,
and an ingredient that falls on an enemy squashes it outright for bonus points.

Serve all four burgers to clear the level; the next level is faster and sends
more enemies.

## Board geometry

The whole game lives on a 640×600 canvas.

| Element | Value |
|---|---|
| Girders (floors) | 5, at y = 80, 176, 272, 368, 464 (`FLOOR_YS`) |
| Plate / tray line | y = 552 (`TRAY_Y`) |
| Burger columns | 4, left edges at x = 48, 192, 336, 480 (`COLUMN_X`) |
| Ingredient width | 112 px = 4 segments of 28 px (`SEGS` × `SEG_W`) |
| Ladder lanes | 5, at x = 24, 176, 320, 464, 616 (`LADDER_XS`) |

Every girder spans the full width of the canvas, so horizontal movement is
never blocked; the level's shape comes from which **ladder lanes** connect which
pair of girders. `LADDER_LANES[g]` lists the lanes that join floor `g` to floor
`g + 1`, and it alternates `[0, 2, 4]` / `[1, 3]` so the chef has to zig-zag to
climb the board. Ladder lanes sit in the gaps between burger columns, so a
ladder never overlaps an ingredient.

Each column starts with four ingredients — bun top, lettuce, patty, bun bottom —
resting on floors 0, 1, 2 and 3. Floor 4 is a clear run-up above the plate.

## Mechanics

### The chef

The chef is either **walking** (`chef.mode === 'walk'`, pinned to the y of
`chef.floor`) or **climbing** (`chef.mode === 'climb'`, pinned to the x of a
ladder lane). Pressing up or down while walking starts a climb if a ladder lane
within `LADDER_SNAP` (14 px) connects the current floor in that direction;
arriving at the girder above or below returns the chef to walking. Movement is
`CHEF_SPEED` = 110 px/s horizontally and `CLIMB_SPEED` = 90 px/s vertically.

### Stamping and dropping ingredients

An ingredient is four independent segments. While the chef walks on the same
floor as an ingredient, any segment his feet are over is marked *stepped* (and
is drawn pressed down). When all four segments are stepped the ingredient drops.

**Drop rule.** A dropping ingredient falls exactly **one floor**. When it starts
falling its `floor` is immediately advanced to the target floor, so at most one
ingredient ever occupies a given (column, floor) slot. If an ingredient is
already resting on the target floor, that one is knocked into a drop of its own
(`chain + 1`) and the arriving ingredient settles into the slot it just vacated.
The result is a satisfying ripple down the stack rather than an
everything-cascades-to-the-plate chain reaction.

Landing on a girder scores `DROP_SCORE` (50) plus `CHAIN_BONUS` (25) per level of
ripple — an ingredient knocked loose by the one above is worth more than one you
walked across yourself — and resets the segments, so the ingredient must be
walked across again to move it further. Dropping past floor 4
lands the ingredient on the plate: it is added to `tray[col]`, and when a column
holds all four ingredients the burger scores `BURGER_SCORE` (500). Serving every
burger clears the level for `LEVEL_SCORE` (1000).

### Enemies

Enemies use exactly the same walk/climb rules as the chef, driven by a greedy
chase: on the chef's floor they walk toward him; otherwise they head for the
nearest ladder lane leading toward his floor and climb it. They spawn on the
bottom girder at the outer lanes on a timer, up to `2 + level` at once, and move
at `enemySpeed()` = 52 + 6 × level px/s (capped).

Touching an un-stunned enemy costs a life: the chef is returned to his start
position and the board is cleared of enemies, but ingredient progress is kept.
Losing the last life ends the game.

### Pepper

`throwPepper()` puffs a cloud `PEPPER_REACH` (26 px) ahead of the chef for
`PEPPER_LIFE` seconds. Any enemy inside is stunned for `STUN_TIME` (4 s):
stunned enemies freeze and are harmless to touch. The chef starts each life with
`START_PEPPERS` (5) shakers; the count refills when a level is cleared.

An ingredient that falls through an enemy squashes it for `100 × 2^n` points
(capped at 800) where `n` is the number squashed by that single fall.

## Controls

| Key | Action |
|---|---|
| ← / → / A / D | Walk left / right |
| ↑ / ↓ / W / S | Climb a ladder |
| Space | Start the game, or throw pepper while playing |
| P | Pause / resume |

## Code structure

`game.js` is a single classic (non-module) script — no bundler, no imports — so
that every piece of state is reachable from the Playwright tests as a plain
global, matching Kaboom, Dino Run, Snake and the other games in this repo.

- **Constants** describe the board geometry and the difficulty curve.
- **State**: `state` (`'idle' | 'running' | 'paused' | 'over'`), `score`,
  `best`, `level`, `lives`, `pepperCount`, plus the `chef` object and the
  `ingredients`, `enemies`, `puffs`, `tray` and `particles` collections.
- **`step(dt)`** advances the whole simulation by `dt` seconds and is the only
  place physics happens. The real-time `requestAnimationFrame` loop just
  measures a delta and calls `step()`, so tests can drive the game frame by
  frame with no wall-clock dependency.
- **`draw()`** is pure rendering and never mutates game state.
- Test seams: `setChef(x, floor)`, `setChefDir(dx, dy)`, `dropIngredient(ing)`,
  `ingredientAt(col, floor)`, `spawnEnemy(opts)`, `throwPepper()`,
  `startGame()`, `endGame()`, `togglePause()` and the `autoSpawn` flag, which
  tests set to `false` to keep the enemy spawner from interfering.

`ingredients` is built in a stable order — column-major, four kinds per column —
so `ingredients[0]` is column 0's bun top, `ingredients[1]` its lettuce, and so
on. Tests rely on that ordering.

The best score is persisted in `localStorage` under `burgertime-best`.

## Assumptions

Decisions taken autonomously where the brief was open-ended; the simpler
interpretation was chosen each time.

1. **Branch name.** The task asked for a branch named after the game
   (`burger-time`), but this session's standing instructions designate
   `claude/loving-euler-4nbaqn` as the branch to develop and push to, and to
   never push elsewhere without explicit permission. The designated branch wins;
   all work lands there.
2. **Full-width girders.** Real Burger Time has gapped platforms that force
   specific routes. Full-width girders plus alternating ladder lanes give the
   same zig-zag routing with far simpler collision code, and guarantee every
   ingredient is always reachable.
3. **One floor per drop.** See the drop rule above. The alternative — a falling
   ingredient carrying everything below it to the plate — would clear a column
   in two walk-overs and make the game trivial.
4. **No enemy "riding".** In the arcade original an enemy standing on a dropping
   ingredient rides it down and adds an extra floor of travel. Here a falling
   ingredient simply squashes anything it passes through; the ingredient's own
   travel is unaffected.
5. **Stepping is position-based, not direction-based.** Any frame in which the
   chef's feet are over a segment stamps it, whichever way he is facing. Walking
   back and forth over the same segment therefore does nothing extra.
6. **Enemies chase greedily** with no path memory or randomness, which keeps the
   simulation deterministic and the tests stable.
7. **Peppers do not refill on death**, only on clearing a level, so the shaker
   count is a real resource across a life.
8. **Fixed level layout.** Every level uses the same girder/ladder/ingredient
   layout; difficulty comes from enemy count and speed rather than new maps.
