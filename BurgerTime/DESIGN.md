# Burger Time — Design

## Concept

Burger Time is a platform-and-ladder arcade game inspired by the 1982 Data East
classic. A chef is loose in a diner kitchen built from girders and ladders, with
three unfinished burgers spread across it — every ingredient sits on its own
girder. Walking the full width of an ingredient knocks it down onto the one
below, which knocks *that* one down, and so on until the whole burger lands on
the plate at the bottom. Assemble all three burgers to clear the level.

Hot dogs, eggs and pickles chase the chef the whole time. Touching one costs a
life. The chef's only weapon is a shaker of pepper: a cloud of it freezes
anything caught in the blast. Dropping an ingredient on top of an enemy flattens
it outright — and is worth far more than the pepper.

## Mechanics

- **The kitchen** is a 640×480 canvas on a 20×15 grid of 32px tiles. Five
  girders (`FLOOR_ROWS`) run the full width; the lowest is the plate floor, which
  doubles as the ground the chef walks on. Four ladders (`LADDER_COLS`) run the
  full height and connect every girder.
- **Burgers.** Three stacks (`STACK_COLS`), each holding a top bun, lettuce, a
  patty and a bottom bun. Each piece is four tiles (128px) wide and starts on its
  own girder, top to bottom.
- **Treading.** A piece is divided into four segments. Standing on a segment
  marks it; when all four have been trodden the piece drops. Segments are marked
  only while the chef is standing on that piece's own girder, so walking
  underneath one is safe.
- **Falling and cascading.** A dropped piece heads for the first girder below it
  that holds no ingredient. Every pile it would pass through is swept along, so
  treading on the top bun of an untouched burger sends all four ingredients to
  the plate in one run. The destination is resolved *once*, when the piece is
  knocked loose, which keeps the fall independent of the order pieces happen to
  be updated in.
- **Plating.** Reaching the plate floor serves the piece; it stacks up neatly on
  the plate. When every piece of every burger is served the level is complete.
- **Enemies** walk girders and climb ladders toward the chef. On the chef's own
  girder they walk straight at them; anywhere else they climb if they are already
  on a ladder, and otherwise head for the ladder with the shortest detour
  (`bestLadderFor`). Touching the chef costs a life.
- **Pepper.** `Space` throws a cloud in the direction the chef faces. Anything
  caught freezes for `STUN_TIME` seconds — stunned enemies neither move nor
  bite. Five shakes per level.
- **Squashing.** An enemy caught under a falling ingredient is flattened, worth
  `SQUASH_POINTS` × how many that ingredient has flattened on its way down, so
  lining several up under one drop is the big-money play. Squashed enemies come
  back at their spawn point after `RESPAWN_DELAY` seconds.
- **Lives.** Three. Losing one resets the chef and the enemies to their spawns
  and grants `INVULN_TIME` seconds of grace; the burgers stay exactly as they
  were. When the last life goes, the game ends.

### Scoring

| Event | Points |
|---|---|
| Knocking an ingredient loose | `DROP_POINTS` (50) |
| Each ingredient served on a plate | `PLATE_POINTS` (100) |
| Squashing an enemy | `SQUASH_POINTS` (500) × that ingredient's squash count |
| Completing a level | `LEVEL_BONUS` (1000) |

### Difficulty scaling (pure functions of `level`)

| Quantity | Formula |
|---|---|
| `enemySpeed` | `ENEMY_BASE + (level-1) * ENEMY_STEP` |
| `enemyCount` | `min(1 + level, ENEMY_SPAWNS.length)` |

## Controls

| Input | Action |
|---|---|
| ← / → / A / D | Walk along a girder |
| ↑ / ↓ / W / S | Climb a ladder |
| Space | Throw pepper (start / restart when not playing) |
| P | Pause / resume |

Climbing takes priority over walking when both are held, matching the arcade
feel.

## Code structure

Everything lives in one classic (non-module) script, `game.js`, the same shape
as Kaboom!, Dino Run and Tetris in this repo, so the Playwright tests can reach
the state and helpers as plain globals.

- **Geometry helpers** — `floorY`, `ladderX`, `stackX`, `floorIndexNear`,
  `ladderIndexNear`. Positions are pixels; girder membership is a snap test
  rather than a stored row, which keeps continuous movement and grid logic in
  one representation.
- **`moveActor`** — shared by the chef and the enemies. Vertical movement is
  allowed only while lined up with a ladder (and snaps to its centre); horizontal
  movement only while standing on a girder.
- **`treadOnPieces` / `dropPiece` / `landPiece`** — the ingredient rules above.
- **`enemyThink` / `updateEnemies`** — chase AI and stun/respawn timers.
- **`step(dt)`** — advances everything in fixed 1/240s sub-steps, so nothing
  tunnels through a girder, an ingredient segment or an enemy regardless of
  frame rate. `frame()` (the `requestAnimationFrame` loop) calls the very same
  `step` the tests call.

## Determinism & testing

The simulation contains no `Math.random()` at all: enemy spawns, enemy movement
and ingredient falls are all fixed. Tests drive the game by calling
`startGame()`, positioning the chef with `placeChef(x, y)`, steering it with
`moveChef(dx, dy)`, dropping ingredients with `dropPiece(p)` and stepping frames
by hand — never depending on `requestAnimationFrame` wall-clock timing. Tests
that care about the chef's movement clear `enemies` first so a stray hot dog
cannot perturb the run.

## Assumptions

These choices were made where the brief was open-ended; the simpler option was
taken each time and recorded here:

- **Full-height ladders.** Every ladder runs from the top girder to the plate
  floor. The arcade original uses partial ladders, which makes level design a
  reachability puzzle; full-height ladders guarantee every ingredient is
  reachable and every enemy path exists, with no solvability analysis needed.
- **One fixed level layout.** Later levels reuse the same kitchen with faster and
  more numerous enemies, rather than introducing new girder arrangements.
- **Enemies do not ride ingredients.** In the arcade, an enemy standing on a
  falling ingredient rides it down and pushes it an extra level. Here a caught
  enemy is simply squashed. Squash scoring still rewards chaining several
  enemies into one drop.
- **Points for treading, not for the cascade.** Knocking a piece loose scores
  once, no matter how many pieces the cascade sweeps along; the cascade pays out
  through the per-ingredient plate bonus instead. This keeps scoring easy to
  reason about and to test.
- **Losing a life leaves the burgers alone.** Only the chef and the enemies
  return to their spawns, so a death does not undo progress.
- **Releasing the climb key stops the chef mid-ladder** rather than continuing to
  the next girder. Direction is strictly a function of the keys currently held,
  which is the simplest model and the easiest to test.
- **Keyboard only.** No mouse or touch controls, since the game needs four
  directions plus a fire button.
- **Branch naming.** The task asked for a branch named after the game
  (`burger-time`), but this repository's automation pins development to the
  assigned branch `claude/loving-euler-edv6xk`. The assigned branch wins; the
  game folder and everything in it still carry the game's own name.
