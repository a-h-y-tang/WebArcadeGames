# BurgerTime — Design

## Concept

BurgerTime is a platform/puzzle arcade game inspired by the 1982 Data East
classic. **Chef Pepper** runs around a lattice of floors and ladders suspended
in a giant kitchen. Scattered across the upper floors are the parts of three
hamburgers. Walking the full width of an ingredient makes it collapse and fall
to the floor below; keep knocking pieces down until every one lands on the plate
at the bottom and the level is cleared.

Three pieces of angry food — a **hot dog**, a **pickle** and a **fried egg** —
chase the chef around the same lattice. Touching one costs a chef. The chef
fights back two ways: a shake of **pepper** freezes anything caught in the
cloud, and an ingredient dropped on a pursuer squashes it flat for big points.

## Mechanics

### The board

The 600×520 canvas holds a fixed lattice:

- **Six floors** at `FLOOR_Y = [70, 150, 230, 310, 390, 470]`, each running the
  full width from `FLOOR_X0` to `FLOOR_X1`. The bottom floor (index
  `PLATE_LEVEL`) carries the three plates.
- **Six ladders**, each described by `{x, top, bottom}` where `top`/`bottom` are
  floor indices. Four run the full height (x = 30, 210, 390, 570) and two are
  shortcuts: x = 105 spans floors 2–5 and x = 495 spans floors 0–3.
- **Three burgers** whose columns start at `BURGER_X = [60, 240, 420]`. Each
  burger is four ingredients — bottom bun, patty, lettuce, top bun — and each
  ingredient is `SEG_COUNT` (4) segments of `SEG_W` (30) pixels, so an
  ingredient is 120px wide.

At the start of a level the top bun sits on floor 0, lettuce on floor 1, patty
on floor 2 and the bottom bun on floor 3, so the bottom bun is the first piece
to reach the plate.

### Movement

Positions are plain pixels; the lattice is enforced by two predicates:

- `floorIndexAt(y)` — the floor a character is standing on, or `-1`. Horizontal
  movement is only allowed when this is non-negative.
- `ladderAt(x, y, dir)` — the ladder reachable from `(x, y)` heading up (`-1`)
  or down (`+1`). Grabbing a ladder snaps `x` to the ladder's column, so you do
  not have to be pixel-perfect (`LADDER_SNAP` = 10px of slack).

Climbing runs freely between the ladder's end floors and clamps there. Stepping
*off* a ladder onto an intermediate floor works whenever you are within
`FLOOR_SNAP` (7px) of it and press left or right — the chef is snapped onto the
floor and walks away. Sideways input in the middle of a ladder does nothing.

### Knocking ingredients down

Every frame, `stepOnIngredients()` looks at the floor the chef is standing on
and marks any ingredient segment whose horizontal band contains the chef as
`stepped` (the segment visibly sags by `SEG_DIP`). The marks persist, so
several passes work as well as one. When all four segments of an ingredient are
stepped it starts falling.

Falling resolution (`landIngredient`) follows the arcade rules:

- Landing on an **empty floor**: the ingredient rests there and its segments
  reset, ready to be walked again.
- Landing on **another resting ingredient**: the ingredient takes that floor and
  the one it hit is knocked down a further floor. That can chain all the way to
  the plate, which is where the big scores come from.
- Landing on the **plate**: the ingredient is `plated`, `plates[burger]` grows,
  and the piece stacks `ING_H` pixels above the previous one.

Every landing scores `POINTS_DROP` (50). When all twelve pieces are plated the
level is cleared: `LEVEL_BONUS` (1000) points, one pepper back (capped at
`START_PEPPER`), and a fresh set of burgers with one more enemy.

### Enemies

Enemies use the same floor/ladder predicates as the chef, so they are bound by
exactly the same lattice. Their chase is a deterministic greedy search with **no
random numbers at all**:

1. If the chef is on a different height and a usable ladder is within reach,
   take it.
2. Otherwise walk toward the usable ladder that minimises
   `|ladder.x - enemy.x| + |ladder.x - chef.x|` — i.e. the ladder that is both
   close and on the way.
3. If the chef is at the same height, walk straight at them.

An enemy re-decides whenever it is standing on a floor, and `moveEnemy` stops it
at **every floor it crosses** while climbing, so decisions get re-made at each
junction rather than only at the ends of a ladder.

- Touching the chef costs a life; the chef and every enemy return to their spawn
  points (`resetPositions`). Losing the last life ends the game.
- A falling ingredient that overlaps an enemy squashes it: `POINTS_SQUASH` (500)
  points, and the enemy is out of play for `RESPAWN_TIME` (6s) before returning
  at a spawn point.
- Enemy speed is `ENEMY_BASE_SPEED + (levelNumber - 1) * ENEMY_SPEED_STEP`, so
  every cleared level makes the kitchen more dangerous.

### Pepper

`sprayPepper()` spends one pepper and puts a cloud `SPRAY_OFFSET` pixels in
front of the chef for `SPRAY_LIFE` seconds. Any enemy overlapping the cloud gets
`STUN_TIME` (3s) of freeze. Frozen enemies do not move and cannot hurt the chef,
so a stun is also a way through a blocked ladder. You start each game with
`START_PEPPER` (5) and get one back per level cleared.

## Controls

| Input | Action |
|---|---|
| ← / → / A / D | Walk along a floor |
| ↑ / ↓ / W / S | Climb a ladder |
| Space | Start the game / shake pepper while playing |
| X | Shake pepper |
| P | Pause / resume |

## Code layout

| File | Contents |
|---|---|
| `index.html` | HUD, canvas, overlay and help strip |
| `style.css` | Dark arcade cabinet styling shared in spirit with the other games |
| `game.js` | Constants, simulation, rendering, input, main loop |
| `tests/burgertime.spec.js` | The Playwright suite (69 tests) |

`game.js` is a single classic (non-module) script, so its state (`state`,
`score`, `chef`, `ingredients`, `enemies`, `plates`, `sprays`, …) and its
functions (`startGame`, `step`, `setChefDir`, `dropIngredient`, `sprayPepper`,
`spawnEnemy`, `floorIndexAt`, `draw`, …) are reachable from Playwright as plain
globals — the same pattern used by Kaboom!, Dino Run, Snake and Tetris.

## Determinism & testing

All motion is expressed per-second and advanced through `step(dt)`, which is a
no-op unless `state === 'running'`. Tests drive the game by calling
`startGame()`, positioning the chef and ingredients directly, and then calling
`step(1/60)` in a loop — never relying on `requestAnimationFrame` wall-clock
timing. Nothing in the simulation calls `Math.random()`: enemy pathing is the
deterministic greedy rule described above, so a given board state plus a given
input sequence always produces the same result.

The game was built test-first: the whole spec was written against this API
before `game.js` existed, run to watch it fail, and then implemented until all
69 tests were green.

## Assumptions

These choices were made where the brief was open-ended; the simpler option was
taken each time and recorded here.

- **Branch name.** The task asked for a branch named after the game
  (`burger-time`), but this session is also configured to develop and push on
  `claude/loving-euler-wp9dqb`, with an explicit instruction never to push
  elsewhere. The designated branch won; the game folder and the game-browser id
  carry the kebab-case name instead.
- **One level layout, escalating difficulty.** The arcade original ships several
  hand-drawn stages. Here there is a single lattice; clearing it rebuilds the
  same board with one more (and slightly faster) enemy. That keeps the level
  data small and the tests stable.
- **Full-width floors.** Every floor runs edge to edge rather than having gaps.
  Combined with two full-height ladders on the outside, that guarantees the
  board is always fully traversable and no ingredient can become unreachable.
- **The chef is not carried by falling ingredients.** In the original the chef
  can ride a falling piece (and be knocked off the board). Here falling
  ingredients pass the chef harmlessly and only interact with enemies. Riding
  adds a second physics path for one visual flourish.
- **Frozen enemies are harmless.** Peppered enemies are skipped by the collision
  check, so the chef can walk through them. This makes pepper a reliable escape
  tool, which matters more than fidelity here.
- **Ingredients are pushed down exactly one floor.** An ingredient landing on
  another sends *that* one down a single floor rather than computing a whole
  stack drop; chains happen naturally because each landing re-runs the same
  rule.
- **No bonus items or per-enemy behaviour differences.** Hot dog, pickle and egg
  differ only in colour, sprite and spawn point — they share one chase routine.
  Distinct personalities would need per-type tuning without changing the shape
  of the code.
- **Pepper does not regenerate during a level.** You get five, plus one per
  level cleared. A timed refill would add another timer for little gain.
- **Deaths do not reset the burgers.** Losing a chef only resets positions; the
  ingredients you have already knocked down stay where they are. Losing the
  progress as well felt punishing without adding anything to the design.
