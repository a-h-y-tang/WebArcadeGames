# BurgerTime — Design

## Concept

Chef Peter Pepper is trapped in a maze of platforms and ladders inside a giant
burger kitchen. Sixteen burger ingredients — four stacks of top bun, lettuce,
patty and bottom bun — are scattered across the floors. Walking the full width
of an ingredient makes it drop to the floor below; drop every piece of a stack
onto the plate at the bottom and the burger is built. Meanwhile hot dogs,
pickles and eggs hunt the chef down the ladders. The chef's only weapon is a
finite supply of pepper, which freezes a monster for a few seconds so it can be
walked over — or, far better, crushed under a falling slab of beef.

## World geometry

All coordinates are plain canvas pixels; the canvas is a fixed `640 x 560`.

| Element | Value |
|---|---|
| Floors (walk surfaces) | `FLOOR_Y = [80, 160, 240, 320, 400, 480]` (floor index 0 = top) |
| Burger columns (left edge) | `COLUMN_X = [16, 176, 336, 496]`, each `128` px wide |
| Ingredient segments | 4 per ingredient, `SEG_W = 32` |
| Ladders | x = `80, 240, 400, 560` (column centres, full height) and `160, 320, 480` (gaps, floors 1–5 only) |
| Plate line | `PLATE_Y = 524`, one plate under each column |

An ingredient's `y` is the y of its **top** edge; at rest on floor `f` it is
`FLOOR_Y[f] - ING_H`, so its underside lines up with the walking surface and the
chef standing on it has the same feet-y as the chef standing on bare floor.

## Mechanics

**Walking an ingredient down.** Each ingredient has four independent segment
flags. While the chef stands on the ingredient's floor and his centre is inside
segment *i*, that segment is stepped (and visibly sinks). When all four are
stepped the ingredient starts falling. Segment flags reset once it lands, so a
piece must be re-walked on every floor.

**Falling and chaining.** A falling ingredient descends at `FALL_SPEED` until it
reaches the rest position on the next floor down. If another ingredient of the
same column is resting there, that one is knocked loose too and both keep
falling — the classic chain drop. Below the bottom floor the piece settles onto
the column's plate, stacking upward in arrival order.

**Riding.** The chef and any monster standing on an ingredient when it drops
ride it down. For the chef this is free travel; for a monster it is fatal.

**Squashing.** Any monster overlapping a falling ingredient is crushed. Points
escalate with the number of monsters caught by a single drop (500, 1000, 2000,
4000), which is the game's main scoring lever.

**Pepper.** `Space` throws a pepper cloud one tile ahead of the chef. Monsters
caught in it freeze for `STUN_TIME` seconds; frozen monsters are harmless and
can be walked through. Pepper is limited per life, so it is an escape tool
rather than a weapon.

**Monsters.** Spawn at the bottom floor on alternating sides, on a timer that
shortens with level. Their movement is fully deterministic — no randomness — so
tests can predict it: a monster on the chef's floor walks straight at him;
otherwise it walks to the nearest ladder that leads toward the chef's floor and
climbs one floor at a time. Touching an unfrozen monster costs a life and
resets the chef, the monsters and any in-flight ingredients.

**Level flow.** All sixteen ingredients plated clears the level: a bonus is
awarded, the layout resets and monsters get faster with a shorter spawn timer.
Losing the last life ends the run and writes the high score to
`localStorage` under `burgertime-best`.

## Controls

| Input | Action |
|---|---|
| `←` `→` | Walk along a floor |
| `↑` `↓` | Climb a ladder (only when lined up with one) |
| `Space` | Throw pepper |
| `Enter` / Start button | Start a run |
| `P` | Pause / resume |

## Code structure

Single non-module script (`game.js`) exposing its state as plain globals, which
matches Kaboom, Snake and Tetris in this repo and lets the Playwright specs
inspect and drive the simulation directly. All motion is expressed per second
and advanced through `step(dt)`; `requestAnimationFrame` only supplies `dt` and
calls `draw()`. Tests therefore never wait on wall-clock animation — they call
`step(1/60)` in a loop and assert on the resulting state.

Key globals: `state`, `score`, `best`, `lives`, `level`, `pepper`, `chef`,
`monsters`, `ingredients`, `peppers`, plus the geometry constants above and the
functions `startGame()`, `step(dt)`, `firePepper()`, `togglePause()`,
`levelComplete()`.

## Assumptions

These are the ambiguous points, each resolved toward the simpler reading:

1. **Branch name.** The task asked for a branch named after the game
   (`burger-time`), but this session is pinned to the designated development
   branch `claude/loving-euler-r0kqyi`, and pushing anywhere else is not
   permitted. The work is committed there instead.
2. **Ladder layout.** Real BurgerTime uses a hand-drawn, partly disconnected
   ladder maze per level. This version uses a regular lattice — full-height
   ladders at the four column centres and floor-1-and-below ladders in the three
   gaps. Every floor stays reachable, which keeps the level always solvable and
   the monster pathing deterministic.
3. **One level layout.** Levels 2+ reuse the level 1 layout and scale difficulty
   (monster speed, spawn rate, monster cap) rather than introducing new maps.
4. **Ingredient set.** Four pieces per burger (top bun, lettuce, patty, bottom
   bun) rather than the arcade's variable five-or-six piece stacks.
5. **Ingredient order.** Starting floors are fixed per column, chosen so that a
   stack's lower pieces begin lower — a burger always assembles in the correct
   visual order without needing per-piece ordering logic on the plate.
6. **Pepper refills** on losing a life and on clearing a level, rather than
   being a persistent resource; this keeps a bad level from cascading.
7. **No sound.** Consistent with every other game in the repo.
8. **Frozen monsters are harmless** and can be walked through, matching the
   arcade; they do not block movement.
