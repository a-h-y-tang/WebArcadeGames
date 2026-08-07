# Burger Time — Design

How the code works, why it is shaped this way, and which calls the tests lean on.

## Concept

A platform-and-ladder arcade game. Four burgers hang in pieces across a
five-storey kitchen. The chef runs along floors and climbs ladders; walking
across every slice of an ingredient makes it fall one floor. Ingredients knock
each other loose on the way down and pile up on the plates at the bottom.
Roaming food enemies chase the chef the whole time — a falling ingredient
flattens any of them caught underneath, and a shake of pepper freezes them in
place for a few seconds.

Assemble all four burgers to clear the level.

## Mechanics

### The level

- Six walkable floors at fixed `FLOOR_Y` heights. The lowest one carries the
  plates, so it is both a floor the chef can run along and the resting place
  for finished burgers.
- Ladders are declared per gap in `LADDER_GAPS`: entry `i` lists the x columns
  that connect `FLOOR_Y[i]` to `FLOOR_Y[i + 1]`. Columns are staggered between
  gaps, so climbing from bottom to top requires zig-zagging rather than riding
  one side. `buildLadders()` expands this into flat `{x, y1, y2}` segments.
- Four burger lanes at `LANE_X`. Each lane starts with four ingredients (top
  bun, lettuce, patty, bottom bun) resting on floors 0–3. Floor 4 starts empty,
  which gives every ingredient room to fall before reaching the plate.

### Movement

`moveActor()` is shared by the chef and the enemies, so both obey the same
rules:

- Horizontal movement requires a floor underfoot (`floorIndexAt` within `SNAP`
  pixels). The actor snaps onto the floor line and is clamped to the floor ends.
- Vertical movement requires a ladder at the actor's x that actually travels in
  the requested direction (`ladderAt`). The actor snaps onto the ladder column
  and is clamped to the segment.
- Anything else is a no-op — you cannot step sideways off a ladder mid-climb,
  and you cannot climb where there is no ladder.

The `SNAP` tolerance (6px) is what makes the controls forgiving: arriving near
a floor is enough to turn and walk along it.

### Dropping ingredients

`trampleIngredients()` runs every sub-step. When the chef stands on the same
line as a resting ingredient and inside its span, the slice under them is
marked `stepped` (and visibly sags). Once all four slices are stepped,
`dropIngredient()` fires.

`dropIngredient()` targets exactly one floor down. Before it starts falling it
recursively drops anything already resting on that floor in the same lane —
this is what produces the classic cascade, where a well-timed drop chains a
whole lane onto the plate at once. Because each call moves an ingredient down by
exactly one floor, the invariant "at most one resting ingredient per (lane,
floor)" always holds, so two ingredients can never contend for the same
resting spot.

`updateFalling()` advances every falling ingredient lowest-first, flattens
enemies in the slab's path, and lands it when it reaches `restY()`. Landing on
a floor resets the slices so it has to be walked again; landing on the plate
sets `onPlate`, bumps `plates[lane].count`, and parks the slab one `SLICE_H`
above the previous one so the burger visibly stacks.

### Enemies

Enemies use the same movement rules as the chef plus a greedy chase in
`chooseEnemyDir()`. Direction is only reconsidered at *nodes* — a floor line
crossed while climbing, or a ladder column / floor end crossed while walking
(`NODE_X`, `crossed()`). At a node they score each legal direction by the
Manhattan distance to the chef, weighting vertical distance 1.6× so getting
onto the chef's floor beats shaving pixels sideways, and never double back
unless it is the only way out.

The AI uses no randomness, so a given board state always produces the same
enemy behaviour and the tests stay deterministic.

Squashed enemies disappear, award `SQUASH_POINTS` doubling per enemy caught in
the same fall, and return after `RESPAWN_DELAY`. Touching an unstunned, living
enemy costs a life; the chef then respawns with `RESPAWN_INVULN` seconds of
grace so a respawn cannot immediately chain into another death.

### Pepper

`usePepper()` spends one shake and stuns every living enemy in a box in front
of the chef (`PEPPER_RANGE` forward, ±22px vertically). Stunned enemies do not
move and cannot hurt the chef, so pepper doubles as an escape and as a way to
set up a squash. Clearing a level refills one shake, capped at `MAX_PEPPER`.

### Levels and scoring

Plating every ingredient calls `completeLevel()`: bonus points, a fresh set of
burgers, one more pepper, and faster enemies (`enemySpeed()` grows with
`level`), with the enemy count rising to `ENEMY_MAX`.

| Event | Points |
|---|---|
| Dropping an ingredient one floor | 50 |
| An ingredient reaching the plate | 100 |
| Squashing enemies in one fall | 100, 200, 400, … |
| Clearing a level | 1000 |

Best score persists to `localStorage` under `burgertime-best`.

## Controls

| Input | Action |
|---|---|
| ← → / A D | Walk along a floor |
| ↑ ↓ / W S | Climb a ladder |
| Space | Shake pepper (or start/restart from the overlay) |
| P | Pause / resume |

The most recently pressed direction wins, so you can hold a direction and tap
another without releasing the first.

## Code layout

| File | Role |
|---|---|
| `index.html` | Canvas, HUD, overlay |
| `style.css` | Layout and theme, matching the other games in the repo |
| `game.js` | Level geometry, simulation, rendering, input |
| `tests/burgertime.spec.js` | Playwright specs |

`game.js` is a single classic (non-module) script, matching Kaboom!, Snake and
Tetris in this repo: the state and the logic functions are plain globals, so
Playwright can reach them with `page.evaluate`. All motion is expressed
per-second and advanced through `step(dt)`, which the render loop and the tests
both drive. `step()` breaks `dt` into 1/240s sub-steps, so a fast-falling
ingredient never tunnels past a floor or an enemy regardless of frame rate.

## Testing

Written test-first. The specs drive the simulation directly rather than
depending on wall-clock animation — for example, `walk(ing)` places the chef on
each slice in turn and calls `step(0.001)`, then the test advances frames until
the ingredient settles.

Covered: the level layout invariants, floor/ladder movement legality and
clamping, slice stepping and the partial-walk case, single-floor drops, the
cascade, plate stacking, enemy motion and bounds, squashing and respawn, life
loss and respawn grace, all five pepper behaviours, level completion, pause,
restart, and score/best persistence. 55 specs.

```powershell
npx playwright test BurgerTime/tests/
```

## Assumptions

Decisions made where the brief or the original arcade game was ambiguous. The
simpler reading was taken each time.

- **Branch name.** The task asked for a branch named after the game
  (`burger-time`), but this session is also required to develop and push on its
  designated branch. The designated branch wins; no `burger-time` branch was
  created.
- **Cascade behaviour.** In the original, an ingredient landing on a resting one
  produces a chain drop. Here that is modelled as "knock the lower one down
  first, then fall one floor" rather than simulating stacked slabs sliding
  together. The visible result is the same chain, and it keeps the
  one-ingredient-per-floor invariant that makes the physics unambiguous.
- **No ingredient stacking on floors.** Ingredients only stack on plates. On a
  floor there is always at most one per lane.
- **The chef cannot ride a falling ingredient.** In the original this is a
  scoring trick; here a falling slab simply passes the chef by. Falling
  ingredients do not hurt the chef either.
- **Stunned enemies are harmless.** Walking through a peppered enemy is safe,
  which makes pepper an escape tool rather than only a delay.
- **Squashed enemies vanish immediately** rather than riding the ingredient down
  and adding to the burger.
- **Enemy variety is cosmetic.** The original has three enemy types with
  different behaviour; here all enemies share one chase AI and differ only in
  colour.
- **Fixed level layout.** Every level reuses the same floors, ladders and
  burgers; difficulty scales through enemy speed and count rather than new
  geometry.
- **Keyboard only.** No touch or gamepad controls, matching the other games in
  the repo.
