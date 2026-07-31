# BurgerTime — Design

## Concept

BurgerTime is a single-screen arcade platform game inspired by the 1982 Data
East classic. You play **the chef**, running along a lattice of floors and
ladders. Scattered across the lattice are the parts of four hamburgers — top
bun, lettuce, patty, bottom bun. Walking across every segment of an ingredient
knocks it down to the floor below; keep knocking it down and it eventually lands
on the plate at the bottom of the screen. Assemble all four burgers to clear the
stage.

Getting there is the problem: **hot dogs, eggs and pickles** roam the lattice
hunting the chef. Touching one costs a life. Your only weapon is a limited
supply of **pepper**, which freezes any enemy caught in the cloud for a few
seconds — and a falling ingredient squashes anything underneath it for a fat
score bonus.

## The world

The play field is a 600×480 canvas divided into a 30 px tile grid (20×16).

| Element | Geometry |
|---|---|
| Floors | 5 walkable lines at `FLOOR_Y = [30, 120, 210, 300, 390]` |
| Ladders | 4 full-height columns at `LADDER_X = [15, 165, 315, 465]` |
| Burgers | 4 stacks, each 4 tiles (120 px) wide, left edges at `x = 30, 180, 330, 480` |
| Plate | A single row below the bottom floor at `PLATE_Y = 450` |

All four ladders run the full height of the lattice, so the graph is fully
connected — the *simpler interpretation* of the arcade original's partial
ladders (see Assumptions).

**Levels.** A vertical slot in a burger column is called a *level*: `0..4` are
the five floors, `5` is the plate (`PLATE_LEVEL`). Every ingredient lives at
exactly one level. Burger *b* starts with its four ingredients at levels 0, 1, 2
and 3, so each burger occupies the top four floors and has to be walked all the
way down to the plate.

## Mechanics

### Movement

The chef and the enemies share one movement routine, `advance()`, driven by a
*wish* direction:

- **Horizontal** movement is only legal while standing exactly on a floor line.
- **Vertical** movement is only legal while horizontally within `LADDER_SNAP`
  (15 px) of a ladder column; starting a climb snaps you onto the ladder centre.
- Climbing past a floor is allowed. If a horizontal wish is held while a climb
  crosses a floor line, the actor **snaps onto that floor and turns** — this is
  what makes cornering feel responsive rather than pixel-perfect.
- The lattice edges clamp movement: no walking off the sides, no climbing above
  floor 0 or below floor 4.

All motion is expressed in pixels per second and applied through `step(dt)`, so
the simulation is frame-rate independent and the Playwright tests can advance it
deterministically without touching wall-clock time.

### Ingredients

Each ingredient is four *segments* wide, one per tile. While the chef's feet are
on the floor line of a resting ingredient, whichever segment the chef's centre
is over gets pressed (`segs[i] = true`). When all four segments are pressed the
ingredient drops.

A dropping ingredient falls at `FALL_SPEED` toward the next level down and then:

- **Empty level** → it lands, its segments reset, and the player scores
  `SCORE_DROP` (50).
- **Occupied level** → the resting ingredient is knocked loose *and* the arriving
  one keeps going, so a full stack cascades down together (the classic chain
  drop). Each level of descent scores `SCORE_DROP`.
- **Plate level** → it settles onto the plate stack, scoring `SCORE_PLATE` (100).
  Plate ingredients pile up in arrival order, which is how the finished burger
  is drawn.

Any enemy overlapping a falling ingredient is squashed for `SCORE_SQUASH` (500).

When all 16 ingredients are on plates, the stage is clear: the player scores
`SCORE_LEVEL` (1000), gains a pepper, and the lattice is rebuilt with faster and
more numerous enemies.

### Enemies

Enemies spawn at the top of the lattice on a timer while the game runs, up to a
per-level cap. Their AI is greedy and re-evaluated whenever they reach a
decision point (a floor line, or a ladder column while on a floor):

1. If the chef is on a different level and a ladder is in reach, climb toward the
   chef.
2. Otherwise walk toward the ladder that best serves reaching the chef's level.
3. If the chef is on the same level, walk straight at them.
4. With a small probability the choice is randomised so enemies do not all
   converge into a single conga line. Randomness comes from a seeded
   `mulberry32` generator (`seedRng(n)`) so tests stay reproducible.

Touching a live enemy costs a life: the chef and all enemies are reset, but the
ingredients keep their progress. Peppered (stunned) enemies are harmless and can
be walked through.

### Pepper

`spray()` costs one pepper and puts a short-lived cloud directly in front of the
chef. Any enemy overlapping the cloud is stunned for `STUN_TIME` (5 s). With no
pepper left the call is a no-op. Pepper is not replenished except by clearing a
stage.

### Scoring, lives, persistence

| Event | Points |
|---|---|
| Ingredient drops one level | 50 |
| Ingredient lands on a plate | 100 |
| Enemy squashed by an ingredient | 500 |
| Stage cleared | 1000 |

The player starts with `START_LIVES` (3) lives and `START_PEPPER` (5) pepper.
The best score is persisted in `localStorage` under `burgertime-best`.

## Controls

| Input | Action |
|---|---|
| ← / → / ↑ / ↓ or A / D / W / S | Walk and climb |
| Space | Throw pepper while playing; start, resume or restart otherwise |
| P | Pause / resume |
| Start button | Start / resume |

## Code layout

```
BurgerTime/
  index.html   markup: HUD, canvas, overlay
  style.css    diner-sign presentation
  game.js      the whole game as a single classic (non-module) script
  tests/burgertime.spec.js   Playwright suite
```

`game.js` is deliberately a classic script rather than a module so that state
and helpers (`state`, `chef`, `ingredients`, `enemies`, `step`, `spray`, …) are
reachable from `page.evaluate()` as plain globals — the same pattern Snake,
Kaboom and Tetris use in this repo.

Structure inside `game.js`:

- **Constants** — geometry, speeds, scores (no magic numbers in the logic).
- **Lattice helpers** — `floorIndexAt`, `ladderXNear`, `restY`, `occupantAt`.
- **Model builders** — `buildIngredients`, `resetLevel`, `startGame`.
- **Simulation** — `advance`, `updateChef`, `updateIngredients`,
  `updateEnemies`, `updatePeppers`, `step(dt)`.
- **Rendering** — `draw()` and per-entity painters.
- **Input & bootstrap** — key handlers, `frame()` rAF loop.

`step(dt)` never runs while `state !== 'running'`, which is what makes pausing
and the game-over screen trivially correct.

### Test hook

The rAF loop only advances the simulation while the global `autoStep` is true.
Tests set `autoStep = false` and then call `step(dt)` themselves, so a test can
simulate exactly 120 frames of 1/60 s and assert on the result without racing
the real animation loop.

## Assumptions

These were resolved autonomously; each takes the simpler reading.

1. **Branch naming.** The task asks for a branch named after the game
   (`burger-time`), but this session is also required to develop and push on its
   designated branch `claude/loving-euler-fciz7i`. The designated branch wins,
   since pushing anywhere else is explicitly forbidden; the game folder name
   (`BurgerTime`) and the games.json id (`burger-time`) carry the naming instead.
2. **Ladders are full height.** The arcade original has partial ladders that make
   routing a puzzle. Full-height ladders keep the movement graph fully connected
   and the AI simple.
3. **Four burgers of four ingredients** on a five-floor lattice, rather than the
   arcade's varied per-stage layouts. Stage progression changes enemy speed and
   count, not geometry.
4. **Falling ingredients do not carry riders.** In the original an enemy standing
   on an ingredient rides it down and is trapped; here any enemy the ingredient
   touches is simply squashed. Same scoring, far less bookkeeping.
5. **Falling ingredients are harmless to the chef** — the chef can neither ride
   nor be hurt by them.
6. **The chef walks along the floor line**, not on top of the ingredient's
   thickness, so there is only one walking surface per floor.
7. **Enemies do not press ingredient segments.** Only the chef does.
8. **No bonus items / no coffee break.** Out of scope for a single-file game.
9. **Death is instant, with no dying animation** — the chef and enemies reset
   immediately and play resumes.
10. **Enemy spawn points are the four ladder tops.** The original drips enemies
    from several off-screen entrances; one row of entrances is enough.
