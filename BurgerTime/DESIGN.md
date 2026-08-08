# Burger Time — Design

## Concept

A platform-and-ladder arcade game. You are a chef trapped on a scaffold of
girders above four dinner plates. Every burger has been scattered up the
scaffold in layers — bun top, lettuce, patty, cheese, bun bottom. Walking the
full width of a layer makes it collapse onto the girder below; keep walking it
down and it lands on the plate. Assemble all four burgers to clear the level.

Meanwhile the food fights back: hot dogs, fried eggs and pickles chase you
across the girders and up the ladders. You have a limited supply of pepper —
a shake of it freezes anything caught in the cloud for a few seconds. A layer
dropped onto an enemy squashes it for a bonus.

## Layout

The 600×560 canvas holds a fixed scaffold:

- **6 floors** at y = 110, 190, 270, 350, 430, 510. The bottom floor
  (`PLATE_FLOOR`) carries the plates; the five above hold ingredients.
- **4 burger columns**, each 96 px wide, starting at x = 72 with a 120 px
  pitch (so columns sit at 72, 192, 312, 432).
- **5 ladders**, at x = 60, 180, 300, 420, 540 — one in each gap between
  columns plus one at each end. Every ladder spans every floor.
- Each ingredient is split into **4 pieces** of 24 px. The chef must touch
  all four for the layer to drop.

At the start of a level, ingredient *k* of every column rests on floor *k*, so
each column is a full burger spread over floors 0–4 with an empty plate on
floor 5.

## Mechanics

### Walking a layer down

`stepOnIngredients()` runs after every chef move. If the chef is standing
exactly on a floor and their x falls inside an un-stepped piece of a resting
ingredient on that floor, that piece is marked stepped (and visually sags by
5 px). When all four pieces are stepped, `dropIngredient()` flips the
ingredient to `fall` and awards 50 points.

### Falling and cascades

A falling ingredient descends at 200 px/s toward the next floor down. On
arrival:

- If that floor is the plate floor, the ingredient becomes `plated` and parks
  at `FLOOR_YS[PLATE_FLOOR] − platedCount(col) × 10`, so plated layers stack.
- If a resting ingredient is already sitting there, it is knocked loose
  (`dropIngredient`) and the arriving layer keeps falling with it — the
  classic cascade, and the main way to build big drops.
- Otherwise the layer rests on the new floor and **its pieces reset**, so it
  has to be walked all over again.

Any enemy inside the column while a layer is passing through is squashed;
each enemy in the same drop is worth `500 × chain` (500, 1000, 1500, …).

### Enemies

Enemies walk toward the chef along their floor. On a different floor they head
for the nearest ladder and climb toward the chef's height. Speed is
`42 + 6 × (level − 1)` px/s, so later levels bite harder. One spawns every
6 seconds (first at 5 s) from a corner of the top or second-from-bottom floor,
capped at `min(5, 2 + level)` on screen.

Touching an un-stunned enemy costs a chef: lives drop, the board's actors
reset, and at zero lives the game ends.

### Pepper

`Space` throws a cloud 26 px in front of the chef. It lives 0.4 s and stuns
every enemy within 22 px for 4 seconds. Stunned enemies stop moving and cannot
hurt the chef, but they can still be squashed. Five shakes per level,
refilled when a level is cleared.

### Levels

When every ingredient is plated, the level is complete: `1000 + 100 × level`
bonus, the level counter increments, pepper refills and a fresh set of burgers
is built with faster enemies.

## Controls

| Input | Action |
|---|---|
| `←` `→` / `A` `D` | Walk along a floor |
| `↑` `↓` / `W` `S` | Climb a ladder (must be within 10 px of its centre) |
| `Space` | Throw pepper (also starts the game from the title/game-over screen) |
| `P` | Pause / resume |
| `R` | Restart |

## Code structure

`game.js` is a single classic script — no modules, no build step — so that
`index.html` works when opened straight off disk. It is organised as:

1. **Geometry & tuning constants** — every magic number lives at the top and is
   reachable from the Playwright tests.
2. **State** — `state`, `score`, `lives`, `level`, `pepper`, `chef`,
   `ingredients`, `enemies`, `peppers`.
3. **Pure-ish helpers** — `columnX`, `pieceCenterX`, `floorNear`,
   `nearestLadder`, `platedCount`, `allPlated`.
4. **Simulation** — `updateChef`, `updateIngredients`, `updateEnemies`,
   `updatePeppers`, `checkChefHit`, all driven by a single `step(dt)`.
5. **Rendering** — `draw()` and its helpers, called from the
   `requestAnimationFrame` loop, never from `step()`.

Splitting `step(dt)` from `draw()` is what makes the game testable: a test can
advance the simulation a deterministic number of fixed 16 ms ticks and read the
resulting state, without waiting on real time or on rendering.

## Testing

`tests/burgertime.spec.js` drives the page with Playwright. Tests were written
before the implementation and cover: the idle screen and HUD, starting a game
and level construction, chef walking/climbing and its bounds, piece stepping,
falling/cascading/plating, enemy movement and collisions, pepper throwing and
stunning, level completion, pause/restart, best-score persistence, and that the
canvas is actually painted.

Because a `requestAnimationFrame` loop is also running in the page, each test
does its stepping inside a single `page.evaluate()` so the manual ticks cannot
interleave with real frames. Tests that need to run for many simulated seconds
raise `lives` so a stray auto-spawned enemy cannot end the run mid-assertion.

One test closes the loop end to end: a small bot repeatedly walks the highest
resting layer across its column and asserts the level is actually cleared, so
stepping, cascading, plating and level completion are proven to work together
and not just in isolation.

## Game browser integration

The Angular game browser reads `game-browser/src/assets/games.json` and serves
each game straight out of the repo root, so listing the game is a single entry:
id `burger-time`, category `Action`, path `games/BurgerTime/index.html`, with
`screenshot.png` as the card thumbnail. The browser's e2e specs assert the total
card count, so that number moves from 104 to 105 alongside the new entry.

## Assumptions

These were resolved by picking the simpler reading, as instructed:

- **Branch name.** The task asked for a branch named after the game
  (`burger-time`), but the session's standing instruction is to develop and
  push only on `claude/loving-euler-0wxw4d`. The standing instruction wins;
  no separate `burger-time` branch is pushed.
- **Every ladder spans every floor.** The arcade original has a ragged ladder
  layout that differs per level. A uniform grid keeps movement predictable and
  the maze readable.
- **One level layout, rising difficulty.** Later levels reuse the same
  scaffold and burgers but speed the enemies up and allow more of them, rather
  than introducing new hand-authored maps.
- **The chef does not ride a falling ingredient.** In the original, standing on
  a layer as it drops carries you down. Here layers pass the chef by; it
  removes a whole class of edge cases around mid-air chefs.
- **Enemies do not walk ingredients down** and are not carried by them — they
  are simply squashed, which keeps enemy logic to "chase the chef".
- **Ingredients are per-column only.** A layer never drifts sideways, so a
  column's stack order on the plate always ends up bun-bottom first.
- **No sound.** Consistent with the other games in this repo.
- **Best score in `localStorage`** under `burgertime-best`, matching the
  convention used by the other games here.
