# BurgerTime — Design

A single-screen, ladder-and-platform arcade game rendered on an HTML5 canvas.
You are a chef in a kitchen maze. Walk the full width of each burger ingredient
to stomp it down a floor; keep stomping until every ingredient lands on the
plate at the bottom of its column. Kitchen creeps chase you the whole time —
squash them under a falling ingredient, blind them with pepper, or die.

## Concept

Four burger columns hang across five walkable floors. Each column holds three
ingredients (top bun, patty, bottom bun) starting on floors 0, 1 and 2. Each
ingredient is split into four segments; the chef presses a segment by standing
on it. When all four segments of an ingredient are pressed, the ingredient
drops one floor. An ingredient that lands where another ingredient is resting
shoves that one down a floor too — the cascade is what makes clearing a column
feel good. An ingredient that drops off the bottom floor lands on the plate.

Plate every ingredient in every column to clear the level. The level then
restarts with faster, more numerous enemies and the score carries over.

## Mechanics

### Geometry

| Constant | Value | Meaning |
|---|---|---|
| `WIDTH` × `HEIGHT` | 560 × 560 | canvas size |
| `FLOOR_Y` | `[96, 182, 268, 354, 440]` | y of each floor's walking surface, top → bottom |
| `PLATE_Y` | 508 | y of the plate surface, below the bottom floor |
| `LADDER_X` | `[16, 144, 272, 400, 528]` | ladder centre x — every ladder spans all five floors |
| `COL_X` | `[80, 208, 336, 464]` | burger column centres |
| `BURGER_W` / `SEG_W` | 96 / 24 | ingredient width and the width of one of its four segments |

Ladders sit in the gaps between burger columns (plus the two outer edges), so a
ladder never runs through an ingredient.

### Movement

The chef walks on a floor (`chef.floor`, an integer) or climbs a ladder
(`chef.climbing`). Left/right move `chef.x`, clamped to the canvas. Up/down
start a climb when the chef is within `LADDER_SNAP` (8px) of a ladder and a
floor exists in that direction; the chef's x snaps to the ladder and `chef.y`
interpolates to the destination floor, at which point `chef.floor` updates and
walking resumes. Horizontal input is ignored while climbing.

`update(dt)` advances everything in milliseconds, so it is frame-rate
independent and tests can drive the simulation directly instead of waiting on
`requestAnimationFrame`.

### Stomping and falling

* Standing on floor `f` inside column `c` presses the segment under the chef's
  centre, if an un-plated, non-falling ingredient of that column rests on `f`.
* All four segments pressed → `dropIngredient()`: the ingredient starts falling
  with `targetFloor = floor + 1`.
* Landing awards `SCORE_DROP` (50). If the target floor is below the bottom
  floor the ingredient is *plated* and stacks on the plate; otherwise it rests
  on the floor and every ingredient already resting there is pushed into a fall
  of its own (one floor per push — the cascade is bounded, not a free fall to
  the plate).
* An enemy overlapping a falling ingredient is squashed: `SCORE_SQUASH` (500)
  points, the ingredient's fall extends one extra floor, and the enemy respawns
  at the top of the kitchen after `RESPAWN_MS`.
* All ingredients plated → `LEVEL_BONUS` (1000) and the next level.

### Enemies

Enemies use the same walk/climb model as the chef with a greedy chase: on the
chef's floor they walk straight at him; otherwise they head for the nearest
ladder and climb toward his floor. Touching the chef costs a life; the chef and
the enemies reset to their spawn positions and play continues until lives run
out.

### Pepper

`Space` throws a pepper cloud onto the floor ahead of the chef. Enemies caught
in it are stunned for `PEPPER_STUN` (3s) and stand still. Pepper is limited
(`PEPPER_START` = 5 per life) and refills on a new level.

## Controls

| Input | Action |
|---|---|
| ← → | walk |
| ↑ ↓ | climb a ladder |
| Space | throw pepper (also starts the game from the title/game-over screen) |
| P | pause / resume |
| Start button | begin a game |

## Assumptions

Made autonomously while building; the simpler reading was taken each time.

1. **Branch name.** The task asked for a branch named after the game
   (`burger-time`), but the session's standing git instruction pins all work to
   `claude/loving-euler-grpvtj` and forbids pushing elsewhere. The standing
   instruction wins; the game name lives in the folder and commit messages.
2. **`DESIGN.md` vs `design.md`.** Existing games ship a lowercase `design.md`;
   the task asked for `DESIGN.md`. This game has `DESIGN.md` (task wording) and
   a player-facing `README.md` like every other game.
3. **Full-width floors.** Every floor is walkable edge to edge and every ladder
   spans all five floors, rather than the arcade original's partial platforms
   and stubby ladders. Navigation stays legible and the enemy chase needs no
   pathfinding beyond "nearest ladder".
4. **Cascades push one floor.** A falling ingredient pushes resting ingredients
   down exactly one floor instead of dragging them all the way to the plate.
   Without this the top ingredient of a column would clear the whole column in
   one stomp.
5. **Falling ingredients do not hurt the chef.** In the arcade the chef can ride
   or be crushed; here only enemies interact with falling food, which keeps the
   only death condition "an enemy touched you".
6. **One level layout.** Later levels reuse the layout and raise enemy speed and
   count (capped at `MAX_ENEMIES`) rather than introducing new maps.
7. **Pepper is a floor-local cloud** with a fixed radius, not a projectile.
8. **Scoring** is 50 per ingredient drop, 500 per squashed enemy, 1000 per level
   cleared. Best score persists in `localStorage` under `burgertime.best`.

## Files

| File | Contents |
|---|---|
| `index.html` | markup, HUD, overlay, canvas |
| `style.css` | kitchen-diner styling |
| `game.js` | constants, state, `update(dt)`, input, rendering — plain globals so tests can poke them |
| `tests/burgertime.spec.js` | Playwright suite driving `update(dt)` and the pure helpers |
