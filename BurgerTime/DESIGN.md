# Burger Time — Design

## Game concept

A girder-maze arcade game. The chef runs along five horizontal girders joined by
ladders. Four burgers hang in pieces above four plates at the bottom of the
screen; walking the full width of a layer knocks it down one girder. March every
layer onto its plate to build all four burgers and clear the level.

Three enemies — a hot dog, an egg and a pickle — chase the chef through the same
lattice. Touching one costs a life. The chef carries pepper shakers: a shake
freezes anything caught in the cloud for a few seconds, and a layer dropped onto
an enemy squashes it for a large bonus.

## Mechanics

### The lattice

- 5 girders (`FLOOR_COUNT`), the bottom one (`PLATE_FLOOR`) holding the plates.
- 5 ladder columns (`LADDER_XS`), repeated between every pair of neighbouring
  girders — a uniform lattice rather than a hand-authored map, so every layer is
  always reachable.
- Actors (chef and enemies) live at a pixel `x`, a `floor` index, and a `y` that
  interpolates between girders while climbing. `moveActor()` is shared by the
  chef and the enemies: walk when there is horizontal intent, grab a ladder when
  there is vertical intent and a ladder within `LADDER_SNAP` pixels.

### Burger layers

- 4 burger columns × 3 layers (top bun, patty, bottom bun), each starting on its
  own girder (`LAYER_FLOORS`).
- A layer is 4 segments wide. Standing on a segment marks it; when all 4 are
  marked the layer drops. Dropping scores `DROP_POINTS` and clears the marks.
- Layers only ever occupy one of the four columns, so a "pile" is simply the set
  of resting layers sharing a column and a girder, stacked bottom-up
  (`pileAt`, `topOfPile`). Only the top of a pile can be trodden on — a buried
  layer is pinned.
- A falling layer lands on top of whatever waits on the next girder down: bare
  steel, another pile, or a plate. Reaching a plate scores `PLATE_POINTS`;
  completing a burger scores `BURGER_POINTS`; serving all four clears the level
  for `LEVEL_POINTS` and restocks a faster one.
- Anything alive under a falling layer is squashed for `SQUASH_POINTS` and comes
  back at its spawn point after `RESPAWN_TIME`.

### Enemies

- Greedy chase: if the chef is on another girder, walk to the nearest ladder that
  closes the vertical gap and climb it; otherwise walk straight at the chef.
- Speed scales with the level (`enemySpeed()`), always below the chef's, so the
  chef can outrun them but not out-wait them.
- Contact with an unstunned, unsquashed enemy costs a life and resets everyone to
  their starting spots; the burgers keep whatever progress they had. Losing the
  last life ends the game.

### Pepper

- `START_PEPPER` shakes per level, refilled on every new level.
- A shake spawns a short-lived cloud just in front of the chef. Enemies inside it
  are stunned for `STUN_TIME` seconds: they stop moving, turn grey and become
  harmless to walk past.

## Controls

| Input | Action |
|---|---|
| ← → / A D | Walk along a girder |
| ↑ ↓ / W S | Climb a ladder |
| Space | Throw pepper (also starts / restarts the game) |
| P | Pause / resume |

## Code layout

- `index.html` — HUD, canvas and overlay markup.
- `style.css` — panel, HUD and overlay styling, matching the other games here.
- `game.js` — a single classic (non-module) script, so state and helpers are
  reachable from the tests as plain globals. All motion is per-second and
  advanced through `step(dt)`, which runs fixed 1/240 s sub-steps; the render
  loop and the tests call the same `step()`, so tests are deterministic and never
  depend on `requestAnimationFrame` timing.
- `tests/burgertime.spec.js` — 88 Playwright tests written before the
  implementation, covering the idle screen, movement, ladders, treading and
  dropping, pile stacking, plating, pepper, enemy chase/stun/squash, lives,
  levels, HUD, scoring, pause/restart and a rendering smoke test.

## Assumptions

These were ambiguous; the simpler reading was taken in each case.

1. **Branch name.** The task asked for a branch named after the game
   (`burger-time`), but the session's standing instruction is to develop and push
   on `claude/loving-euler-lsg07o`. The designated branch wins; the game name
   lives in the folder (`BurgerTime/`) instead.
2. **Uniform ladders.** The arcade original uses a bespoke map per level with
   partial girders and ladders in different places. Here every girder spans the
   full width and every gap carries the same five ladders. This keeps the level
   readable and guarantees reachability without a level editor.
3. **No push-chaining.** In the original, a layer landing on another sends both
   down a further level. Here a falling layer simply lands on top of the pile
   below it, so each layer must be trodden on again at every girder on its way
   down. That is deterministic (no ambiguity about which of two overlapping
   layers lands first) and keeps a level from cascading to completion in one
   drop.
4. **Layers do not carry the chef or enemies down.** Enemies under a falling
   layer are squashed rather than riding it; the chef is unaffected by falling
   layers entirely.
5. **Three layers per burger.** Top bun, patty, bottom bun — enough for the
   layer-marching loop without making a level a slog (24 drops per level).
6. **Enemies do not interact with the burgers.** They walk through piles; only
   the chef's footsteps move layers.
7. **`serveColumn()` is a test seam.** It plates a whole column at once so the
   level/scoring tests do not have to simulate two dozen full traversals. Nothing
   in the real game loop calls it.
8. **Level progression is speed and numbers only** — the layout never changes;
   later levels field more and faster enemies.
