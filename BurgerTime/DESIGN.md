# Burger Time — Design

## Concept

A platform-and-ladder arcade game in the spirit of the 1982 coin-op. You play a
chef in a diner kitchen built from horizontal girders and vertical ladders. Four
burgers hang disassembled across the kitchen, one ingredient per girder. Walking
the full length of an ingredient makes it drop one floor; keep knocking layers
down and they land on the plates at the bottom. Assemble all four burgers to
clear the level.

Three walking snacks — a hot dog, an egg and a pickle — patrol the same lattice
and hunt the chef. Touching one costs a life. The chef's only weapon is a shaker
of pepper: a squirt freezes anything in front of him for a few seconds. The
bigger prize is dropping an ingredient onto an enemy, which squashes it flat.

## Mechanics

### The kitchen

The playfield is a 17 × 15 grid of 28 px tiles (476 × 420 px canvas).

- **Girders** — 5 horizontal floors at grid rows 1, 4, 7, 10 and 13. The bottom
  girder carries the four plates.
- **Ladders** — 5 possible columns (grid cols 0, 4, 8, 12, 16). Each of the four
  gaps between girders exposes only three of those columns, and the pattern
  alternates, so getting from the top floor to a particular plate takes a route,
  not a straight drop.
- **Burgers** — 4 stacks, each 4 tiles (112 px) wide, at grid cols 1, 5, 9 and
  13. Each stack holds a top bun, lettuce, a patty and a bottom bun, resting on
  floors 0–3 respectively.

### Dropping ingredients

Each ingredient is divided into four tiles. Standing on a tile stamps it (the
tile visibly sags). When all four tiles of an ingredient are stamped it starts
falling at a constant 300 px/s.

A falling ingredient stops on the next girder down. If another ingredient is
already resting there, that one is knocked loose and begins falling too — so a
well-timed drop from the top can cascade a whole column onto its plate. Landing
on the plate floor adds a layer to that plate's burger; four layers completes it.

Any enemy overlapping a falling ingredient is squashed flat, worth 100 points,
and stays out of play for 4 seconds before respawning at its spawn corner.

### Enemies

The girder/ladder crossings form a 25-node graph. Enemies walk node to node at a
constant speed, and on arriving at a node they pick the neighbour that is
fewest hops from the chef's nearest node (breadth-first search over the graph),
never immediately doubling back unless it is the only option. 15% of decisions
are random instead, which stops all three from converging into a single train
and keeps them beatable.

Enemies are harmless while stunned or squashed. Level `n` fields
`min(2 + n − 1, 5)` of them, each 5 px/s faster than the level before.

### Pepper

A shot of pepper spends one of the chef's five shakers and paints a cloud
1.5 tiles wide in the direction he is facing. Anything caught in it is frozen for
4 seconds. Each cleared level restores one shaker, up to nine.

### Scoring

| Event | Points |
|---|---|
| Ingredient starts falling | 50 |
| Enemy squashed by an ingredient | 100 |
| Burger completed | 250 |
| Level cleared | 1000 |

The best score persists in `localStorage` under `burgertime-best`.

## Controls

| Input | Action |
|---|---|
| `←` `→` / `A` `D` | Walk along a girder |
| `↑` `↓` / `W` `S` | Climb a ladder |
| `Space` | Throw pepper (also starts / restarts the game) |
| `P` | Pause / resume |
| `R` | Restart |

## Code structure

Everything lives in one classic (non-module) script, `game.js`, so the state and
the logic are reachable from the Playwright tests as plain globals — the same
pattern as Kaboom, Snake and Tetris in this repo.

- **Geometry** (`FLOOR_Y`, `LADDER_X`, `LADDER_SEGS`, `STACK_X`) is derived from
  the tile size, so the whole kitchen rescales from one constant.
- **Lattice helpers** (`neighbors`, `distancesFrom`, `nearestNode`) implement the
  node graph shared by the chef's movement rules and the enemy AI.
- **`moveChef(dt)`** resolves vertical intent first: a climb only starts if the
  chef stands on a girder within half a tile of a ladder column that actually
  has a rung in that direction, and it snaps him onto the ladder's centre line.
  Between girders, horizontal input is ignored.
- **`step(dt)`** is the whole simulation for one slice of time: move, tread,
  fall, chase, pepper, collide, level-up. All motion is expressed per second, so
  tests can advance the clock deterministically.
- **`draw()`** is pure rendering and reads no state it does not own.

### Testability hooks

Two functions exist for the test suite and are harmless in normal play:

- `setAutoRun(false)` detaches the `requestAnimationFrame` driver from `step()`,
  so a test can advance the simulation itself and get identical results every
  run.
- `setSeed(n)` pins the mulberry32 RNG used for the enemies' random tie-breaks.

Tests also use `setChefPos`, `placeEnemy`, `dropIngredient` and `squashEnemy` to
put the game into a specific situation instead of playing towards it.

## Assumptions

These were judgement calls made without a human in the loop; each took the
simpler reading.

- **Branch name.** The task asked for a branch named after the game
  (`burger-time`), but the session's standing instruction pins all development
  and pushes to `claude/loving-euler-w3t18r`. The explicit branch assignment
  wins, so the work lives there rather than on `burger-time`.
- **Chain drops are simplified.** In the original arcade game an ingredient that
  lands on another rides it down an extra floor. Here the faller rests on the
  girder it reaches and the ingredient it hit starts falling on its own. The
  cascade still happens, one floor at a time, and stack order is preserved
  because layers are always knocked down in top-to-bottom order.
- **Enemies do not ride falling ingredients**, and falling ingredients are not
  worth bonus multipliers for multiple squashes. Squashing is a flat 100 points
  per enemy.
- **Enemies do not tread on ingredients.** Only the chef's weight counts.
- **One kitchen layout.** Later levels reuse the same girder/ladder map and get
  harder through enemy count and speed rather than a new map, which keeps the
  difficulty curve predictable and the level data trivial.
- **A stunned or squashed enemy is harmless**, so a chef can walk straight
  through one. This matches the arcade behaviour of peppered enemies.
- **Ladder columns coincide with the outer tile of a burger stack** in three
  cases. That is deliberate — climbing through a burger is part of the original
  game's look — and treading still registers on those tiles.
- **No high-score table, sound or mobile touch controls.** The repo's other
  games persist a single best score in `localStorage`, and this one follows.
