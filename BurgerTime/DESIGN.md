# Burger Time — Design

## Concept

Burger Time is an arcade maze game inspired by the 1982 Data East classic. You
play **Chef Peter Pepper**, trapped in a lattice of platforms and ladders that is
draped with the parts of four giant hamburgers. Walking the full width of an
ingredient knocks it loose; it plummets down the shaft, sweeping any ingredients
below it along for the ride, until the pieces land in order on the plate at the
bottom.

Chasing you the whole time are animated foods — a hot dog, a fried egg and a
pickle — that home in on you through the same lattice. Touching one costs a life.
Your defences are geometry (drop an ingredient on an enemy and it is squashed)
and a limited supply of **pepper**, which freezes any enemy caught in the cloud.

Assemble all four burgers to clear the level. Every level adds a faster, larger
pack of enemies.

## The board

The playfield is a 600×480 canvas cut into 40 px tiles (15 columns × 12 rows).

| Element     | Placement                                                   |
|-------------|-------------------------------------------------------------|
| Floors      | rows 1, 3, 5, 7, 9 → `y` = 40, 120, 200, 280, 360 (full width) |
| Ladders     | columns 3, 7, 11 → `x` = 140, 300, 460 (span every floor)    |
| Burger shafts | columns 0–2, 4–6, 8–10, 12–14 → left `x` = 0, 160, 320, 480 |
| Plates      | row 11 → `y` = 440, one under each shaft                      |

Each burger shaft is three tiles (120 px) wide and holds four ingredients, one
per floor, top to bottom:

| Floor | `y`  | Ingredient   |
|-------|------|--------------|
| 0     | 40   | top bun      |
| 1     | 120  | lettuce      |
| 2     | 200  | patty        |
| 3     | 280  | bottom bun   |

Floor 4 (`y` = 360) is a clear walkway and the chef's spawn line. Sixteen
ingredients in total; when all sixteen are on their plates the level is cleared.

Ladder columns deliberately sit in the one-tile gaps *between* burger shafts, so
climbing never presses an ingredient by accident — the same layout property the
original arcade board has.

## Mechanics

### Dropping ingredients

Every ingredient is split into **three segments**, one per tile. While the chef
is standing on an ingredient's floor with his centre inside a segment, that
segment is *pressed* (and drawn sunk a few pixels). When all three segments of an
ingredient are pressed it is knocked loose: it starts falling and scores
`DROP_POINTS` (50).

### Falling and cascades

A falling ingredient descends at `FALL_SPEED` (220 px/s) and **always travels all
the way to its plate**. If it catches up with a resting ingredient in the same
shaft, that ingredient is knocked loose too and the falling piece settles
`STACK_OFFSET` (10 px) above it, so the pair — and any further pieces they sweep
up — fall as a stack. Because the lower piece always starts falling first, the
pieces reach the plate in the order they were stacked in, which is what makes the
finished burger come out right way up.

Landing is resolved against the plate: the `n`-th ingredient to arrive in a shaft
rests at `PLATE_Y − n × PLATE_STEP`.

> **Simplification.** In the original arcade game an ingredient falls exactly one
> floor unless it is riding another piece. Here a dropped ingredient always runs
> to the plate. This keeps the cascade rule to a single sentence, makes the
> simulation trivially deterministic for the tests, and preserves the part that
> is actually fun — chaining a top bun through the whole shaft in one move.

### Enemies

Enemies walk the same lattice as the chef under a greedy chase:

- On the chef's floor → walk straight at him.
- Otherwise → head for the ladder that minimises `|enemy.x − ladder| +
  `|ladder − chef.x|`, then climb toward the chef's floor.

They are removed two ways:

- **Squashed** — a falling ingredient overlapping an enemy squashes it for
  `SQUASH_POINTS` (100). The enemy respawns after `RESPAWN_DELAY` (4 s).
- **Peppered** — pressing Space fires a pepper cloud in the direction the chef
  faces. Enemies inside it are frozen for `STUN_TIME` (3 s). Pepper is limited
  (5 shots, +1 per level cleared, capped at 9) and scores nothing; it buys space.

Touching an un-stunned enemy costs a life. The chef and enemies return to their
spawn points and the chef is invulnerable for 1.5 s. Burger progress is kept.
At zero lives the game is over.

### Levels

Clearing all four burgers awards `LEVEL_BONUS` (1000), holds a "Level Cleared"
banner for `CLEAR_DELAY` (2.5 s) and then rebuilds the board. Level *n* fields
`min(1 + n, 5)` enemies moving at `46 + (n − 1) × 8` px/s from a fixed spawn
table.

### Scoring

| Event                         | Points |
|-------------------------------|--------|
| Ingredient knocked loose      | 50     |
| Enemy squashed by a fall      | 100    |
| Level cleared                 | 1000   |

The best score is persisted in `localStorage` under `burgertime-best`.

## Controls

| Input                     | Action                                  |
|---------------------------|-----------------------------------------|
| ← / → or A / D            | Walk left / right along a floor         |
| ↑ / ↓ or W / S            | Climb a ladder (only on a ladder column)|
| Space                     | Throw pepper (starts the game when idle)|
| Enter / Start button      | Start or restart                        |
| P                         | Pause / resume                          |

Vertical movement only happens when the chef is within `LADDER_SNAP` (14 px) of a
ladder centre; horizontal movement only happens while standing on a floor (within
`FLOOR_SNAP`, 3 px). Being mid-ladder with no vertical input simply holds
position.

## Code structure

`game.js` is a single classic (non-module) script, matching Kaboom, Snake and
Tetris in this repo, so every piece of state is reachable from Playwright as a
plain global.

- **Geometry helpers** — `floorY`, `ladderXs`, `stackLeftX`, `floorIndexAtY`,
  `ladderXNear`.
- **Board setup** — `buildIngredients()`, `spawnEnemies()`, `resetPositions()`.
- **Simulation** — `step(dt)` advances everything by `dt` seconds in a fixed
  order: chef → segment pressing → falling ingredients → enemies → pepper clouds
  → chef/enemy collision → level-complete check. `requestAnimationFrame` is only
  a thin driver that calls `step` with a clamped delta.
- **Rendering** — `draw()` paints floors, ladders, plates, ingredients, clouds,
  enemies and the chef; the HUD lives in the DOM.

### Determinism & testing

`step(dt)` contains no `Math.random()` and no wall-clock reads. Enemy spawn
points are a fixed table and the chase is a pure function of positions, so a
given sequence of `step` calls always produces the same result. Tests drive the
game by setting `chef.x` / `chef.y` and calling `step(1/60)` in a loop, exactly
as they would in the real frame loop.

## Assumptions

Made autonomously while building this, per the task's instruction to prefer the
simpler reading and record it:

1. **Branch name.** The task asked for a branch named after the game
   (`burger-time`), but the session's standing instruction pins all development
   to `claude/loving-euler-g0uinl` and forbids pushing elsewhere. The standing
   instruction wins; the work lives on `claude/loving-euler-g0uinl`.
2. **Falling depth.** A dropped ingredient runs all the way to the plate rather
   than one floor at a time (see *Falling and cascades* above).
3. **Uniform ladders.** Every ladder column connects every floor. The arcade
   original uses irregular ladder placement per level; a uniform lattice keeps
   the navigation and the enemy AI simple and readable.
4. **One board layout.** Levels reuse the same lattice and get harder purely
   through enemy count and speed, rather than shipping a table of hand-authored
   maps.
5. **Space is overloaded.** Space throws pepper while running and starts the game
   while idle or after a game over — the same key does the obvious thing in each
   state. Enter and the Start button always start.
6. **Enemies are squashed, not ridden.** In the arcade an enemy standing on a
   falling ingredient rides it down and is only trapped when the piece lands.
   Here contact with a falling piece squashes immediately.
7. **No sound.** Consistent with the other games in this repo.
