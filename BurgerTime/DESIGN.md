# Burger Time — Design

## Concept

A single-screen arcade game in the spirit of the 1982 cabinet. You play a chef
trapped in a girder kitchen. Three burgers hang in pieces across four floors;
walking the full width of an ingredient makes it fall to the level below. Get
every layer down onto its plate to clear the level, while three pieces of
walking food try to run you down. You have five shakes of pepper to freeze them.

## Board geometry

The board is a 16 × 13 grid of 40 px tiles drawn on a 640 × 520 canvas.

| Element | Value |
|---|---|
| Floor rows | `1, 4, 7, 10` (y = 40, 160, 280, 400) |
| Ladder columns | `0, 5, 10, 15` (x = 20, 220, 420, 620) |
| Burger lanes | left column `1, 6, 11`, each 4 tiles (160 px) wide |
| Plate row | `12` (y = 480), a pseudo-floor nothing walks on |

Every ladder column connects every pair of neighbouring floors, so the whole
board is reachable from anywhere. Ladders sit in the one-tile gaps between the
burger lanes, so a ladder never runs through an ingredient.

## Movement model

The chef and the enemies share one movement routine (`canGo` / `advance`):

- Horizontal movement is legal only when the entity's `y` is exactly on a floor
  line. Vertical movement is legal only when its `x` is exactly on a ladder
  centre.
- The chef walks 2 px per tick, enemies 1 px (2 px from level 3). All speeds
  divide the grid spacing, so entities always land exactly on floor/ladder
  coordinates and alignment can be tested with `===` instead of a tolerance.
- The chef's direction is **sticky**: a key press sets the desired direction and
  it is retained until another direction is pressed or the path is blocked
  (Pac-Man style). This is the simpler interpretation and keeps the walking
  motion needed to trample ingredients smooth.
- The chef stores a *wanted* direction separately from its *current* direction.
  Each tick, if the wanted direction has become legal it is adopted — so holding
  "up" while walking a floor turns the chef onto the next ladder it reaches.

## Ingredients, stepping and cascades

Each ingredient is 4 tiles wide and 10 px tall, with a `segments` array of four
booleans. When the chef stands on a floor above the topmost ingredient of that
lane's stack, the segment under its feet is marked. When all four are marked the
whole stack on that floor starts falling.

Falling resolves in `updateIngredients` each tick:

1. Every falling piece moves down `FALL_SPEED` (4 px).
2. If a falling piece reaches a *resting* piece in the same lane, it is clamped
   to sit on top of it, that piece is knocked into falling too, and everything
   already falling above it inherits the new target floor. This is what produces
   the classic cascade — dropping the top bun of a full column carries the whole
   burger to the plate in one move.
3. Enemies overlapping a falling piece are squashed (200 points, doubling for
   each extra enemy caught by the same piece).
4. Pieces land, lowest first, at `floorY(target) - LAYER_H * (stackHeight + 1)`,
   so a cascading column keeps its stacking order on the plate.

The level is clear once every ingredient has state `plate`.

## Enemies

Enemies pick a direction only at junctions (on a floor *and* on a ladder) or
when their current direction becomes illegal. They score each legal direction by
the Manhattan distance to the chef after a one-tile step — vertical distance is
weighted 1.4× so they prefer to close the gap on the chef's own floor — plus a
small deterministic jitter from a seeded LCG. Reversing is only chosen when it
is the only legal option. A squashed enemy respawns at its spawn point after 300
ticks (5 seconds), so the pressure never fully lets up.

## Pepper

`Space` throws a cloud in front of the chef: a 46 × 30 rectangle that lives for
24 ticks and stuns any enemy it touches for 200 ticks. Five shakes per level,
refilled when a level starts.

## Scoring

| Event | Points |
|---|---|
| Ingredient lands on a floor | 50 |
| Ingredient lands on a plate | 100 |
| Enemy squashed | 200, doubling per extra enemy in the same drop |
| Level cleared | 1000 |

Best score persists in `localStorage` under `burgertime-best`.

## Level progression

`LEVEL_LAYOUTS` holds three arrangements, cycled by level. Each entry gives the
starting floor of each of the four layers, per lane. Level 1 fills every floor
(so a single drop can cascade a whole burger); later layouts leave gaps and
stack two layers on one floor, which forces several separate walks. Enemy count
is `min(2 + level, 5)` and they double in speed from level 3.

## Testing

Tests drive the game deterministically. `game.js` exposes `autoTick`; setting it
to `false` detaches the `requestAnimationFrame` loop from the simulation so the
spec can call `tickN(n)` and assert on exact pixel positions. The seeded RNG
keeps enemy choices reproducible.

## Assumptions

These were resolved without asking, per the task brief; the simpler reading was
taken each time.

1. **Branch name.** The task asked for a branch named after the game
   (`burger-time`), but the session's standing instruction pins all development
   and pushes to `claude/loving-euler-tt9s6h`. The pinned branch wins; the game
   folder and PR title carry the game's name instead.
2. **Sticky controls.** The chef keeps walking after a key is released rather
   than requiring the key to be held. This matches the other grid games in the
   repo and makes the "walk the whole ingredient" mechanic comfortable.
3. **Ladders everywhere.** All four ladder columns connect all four floors,
   rather than the staggered ladder layout of the arcade original. Difficulty
   comes from the enemies and the burger layouts instead.
4. **No enemy riding.** In the arcade an enemy standing on a dropping ingredient
   rides it down and adds weight to the drop. Here a falling ingredient simply
   squashes anything it touches.
5. **Instant respawn on death.** Losing a life snaps the chef and all enemies
   back to their start positions immediately, with 60 ticks of invulnerability,
   rather than playing a death animation.
6. **Four layers, three burgers.** Bottom bun, patty, lettuce, top bun. No
   cheese and no bonus items.
7. **Level clear is manual.** The level-clear overlay waits for Enter or a click
   rather than auto-advancing, so the score is readable.
