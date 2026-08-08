# Burger Time — Design

## Concept

**Burger Time** is a single-screen ladder-and-platform arcade game inspired by
the 1982 Data East classic *BurgerTime*. The player is a chef trapped inside a
giant kitchen made of four floors joined by ladders. Suspended on those floors
are the layers of four unfinished hamburgers. Walking the full width of a layer
*flips* it, and a flipped layer falls one floor. Keep flipping and a layer
eventually drops onto the plate at the bottom of its column. Assemble all four
burgers and the level is complete.

Three kinds of food monsters — a hot dog, a fried egg and a pickle — hunt the
chef through the same floors and ladders. Touching one costs a life. The chef
fights back two ways: a limited supply of **pepper**, which stuns a monster for
a few seconds, and the falling layers themselves, which squash any monster
caught underneath.

This genre — vertical platforms plus ladders plus a chase — was not represented
anywhere in the repo, which is why it was chosen.

## The board

A 640×600 canvas holds a fixed layout:

| Element | Value |
|---|---|
| Floors | 4 full-width floors at `y = 110, 230, 350, 470` |
| Plate line | `y = 580` (below the bottom floor) |
| Burger columns | 4 columns, 96 px wide, left edges at `x = 32, 192, 352, 512` |
| Ladders | between floors 0↔1 at `x = 160, 480`; 1↔2 at `x = 16, 320, 624`; 2↔3 at `x = 160, 480` |
| Layers per column | 4 — bun top, lettuce, patty, bun bottom (rows 0–3) |

Every ladder sits in the gap *between* burger columns, so climbing never hides a
layer. Because every floor spans the full width, the layout is always fully
connected: any ladder reaches any column.

## Mechanics

### Flipping and falling

- Each layer is 96 px wide and divided into **4 segments** of 24 px.
- When the chef stands on the same floor as a layer and his centre is inside a
  segment, that segment flips. Segments stay flipped.
- When all four segments of a layer are flipped, the layer **drops**: it falls
  straight down at `FALL_SPEED` px/s.
- A layer that lands on a floor rests there with **all segments reset**, so it
  must be walked across again. A layer that lands on the plate is **plated** and
  stacks on top of whatever is already on that plate.
- **Bumping.** If a falling layer lands on a floor cell already occupied by a
  resting layer, that resting layer is bumped and immediately starts falling one
  floor itself. Bumps chain, so a well-timed drop can cascade a whole column.
- The level is complete the moment every layer in every column is plated.

### The chef

The chef is a two-mode state machine:

- **`floor` mode** — walks left/right along the floor he is on, clamped to the
  canvas. Pressing up or down while within `LADDER_SNAP` px of a ladder that
  leads that way switches him to ladder mode and snaps him onto the rail.
- **`ladder` mode** — climbs up/down between the two floors the ladder joins.
  Arriving at either end snaps him back to `floor` mode on that floor. Sideways
  input is ignored mid-climb.

Positions are stored as *feet* coordinates (`chef.y` is the floor line he stands
on), which makes floor snapping and rectangle collisions trivial.

### Monsters

Monsters use the same two-mode movement as the chef and chase **deterministically**:

1. If the monster is on the chef's floor, it walks toward the chef's `x`.
2. Otherwise it walks toward a ladder that leads toward the chef's floor, and
   climbs it on arrival.

To stop a pack from collapsing onto a single ladder and arriving as one blob,
monsters alternate between two routing habits by spawn index: even-indexed
monsters pick the ladder nearest **themselves** (impatient), odd-indexed
monsters pick the ladder nearest **the chef** (they try to cut him off). The
result is a pincer rather than a queue, and it is still a pure function of the
world state.

No randomness is involved anywhere in the simulation, which keeps the game
readable and makes every Playwright test reproducible.

A monster can be neutralised two ways:

- **Pepper** (`Space`): sprays a cloud in front of the chef. Monsters caught in
  the cloud are stunned for `STUN_TIME` seconds — a stunned monster does not
  move and cannot hurt the chef, so he can walk straight over it. Pepper is
  limited (5 per level) and refills when a level is cleared.
- **Squashing**: a falling layer flattens every monster it overlaps. Squashed
  monsters respawn at a spawn point after `RESPAWN_TIME` seconds. Squashing
  several with one layer multiplies the reward.

Touching an un-stunned monster costs a life and resets the chef and all monsters
to their starting positions; layer progress is kept. Losing the last life ends
the game.

### Difficulty

| Level | Monsters | Monster speed |
|---|---|---|
| 1 | 2 | `62` px/s |
| 2 | 3 | `70` px/s |
| 3 | 4 | `78` px/s |
| 4+ | 5 (cap) | `+8` px/s per level |

The layout never changes; the pressure comes from more and faster monsters.

### Scoring

| Event | Points |
|---|---|
| Layer lands on a floor | 50 |
| Layer lands on a plate | 150 |
| Monster stunned by pepper | 100 |
| Monster squashed by a falling layer | 500 × (number squashed by that layer so far) |
| Level cleared | 1000 × level |

The best score is persisted in `localStorage` under `burgertime-best`.

## Controls

| Key | Action |
|---|---|
| ← / → / A / D | Walk left / right |
| ↑ / ↓ / W / S | Climb up / down a ladder |
| Space | Throw pepper (start / restart when not playing) |
| P | Pause / resume |

## Code structure

`game.js` is a single classic (non-module) script — no build step, no imports —
so every piece of state is reachable from the Playwright tests as a plain
global, matching Kaboom, Frostbite, Snake and the rest of the repo.

```
constants ......... geometry, speeds, level layout (LADDERS, BURGER_X, FLOOR_Y)
level building .... buildIngredients(), buildEnemies(), resetPositions()
chef .............. setChefDir(), setChefPos(), updateChef(), ladderAt()
layers ............ ingredientAt(), dropIngredient(), updateIngredients(), landIngredient()
monsters .......... spawnEnemy(), updateEnemies(), killEnemy()
pepper ............ firePepper(), updateClouds()
game flow ......... startGame(), nextLevel(), loseLife(), endGame(), togglePause()
simulation ........ step(dt)   <-- the single deterministic entry point
rendering ......... draw() and its helpers
input ............. keydown/keyup handlers, Start button
```

All motion is expressed per second and advanced only through **`step(dt)`**.
`requestAnimationFrame` merely measures a delta and calls `step`, so the tests
can simulate any number of frames instantly and deterministically without
depending on wall-clock timing.

`step(dt)` runs in a fixed order: chef → layers → pepper clouds → monsters →
chef/monster collisions → deferred events (level clear). Level clearing is
deferred behind a flag so the ingredient array is never rebuilt while it is
being iterated.

### Test hooks

Nothing is mocked; the tests drive the real simulation. Beyond the state
globals (`state`, `score`, `level`, `lives`, `pepper`, `chef`, `enemies`,
`ingredients`, `clouds`) the following helpers exist mainly to let tests place
the world in an exact configuration: `setChefPos(x, row)`, `spawnEnemy(opts)`,
`ingredientAt(col, row)`, `dropIngredient(ing)`, `platedCount(col)`,
`allPlated()`, `floorY(row)`, `ladderAt(x, row, dir)`.

## Assumptions

The task description left a few things open. Each was resolved toward the
simpler reading and recorded here.

1. **Branch name.** The prompt asked for a branch named after the game
   (`burger-time`), but this session is also instructed to develop and push only
   on its designated branch `claude/loving-euler-cjmnem`. The designated branch
   wins; the game name lives in the folder, commits and PR title instead.
2. **Full-width floors.** The arcade original mixes partial floors with gaps
   that force detours. Here every floor spans the full canvas width, which keeps
   the layout guaranteed-connected and the movement code simple. Ladder
   placement supplies the routing challenge.
3. **The chef does not ride falling layers.** In the original a chef standing on
   a layer falls with it. Here falling layers pass the chef harmlessly.
4. **Bump, don't pile.** Two layers never share a floor cell: a layer landing on
   an occupied cell bumps the occupant onward instead of stacking on it. Only
   plates stack.
5. **No weight mechanic.** Monsters squashed under a layer do not add weight to
   push it a further floor down.
6. **No bonus items.** The ice-cream / coffee / chips pickups that award extra
   pepper are omitted; pepper simply refills each level.
7. **Deterministic monsters.** Monster AI is a pure function of the world state
   with no random dithering, so the whole simulation is reproducible.
8. **One layout for all levels.** Levels reuse the same kitchen and scale only
   monster count and speed.
9. **Layer flavours are cosmetic.** Bun/lettuce/patty order in the finished
   stack follows the order the layers happen to be plated in; no bonus is given
   for assembling them "correctly".
