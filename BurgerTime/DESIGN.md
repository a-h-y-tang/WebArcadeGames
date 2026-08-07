# BurgerTime — Design

A single-screen arcade game on an HTML5 canvas: Chef Pepper runs across a lattice
of floors and ladders, stomping burger ingredients down onto the plates below
while three food enemies hunt him.

## Game concept

Four burgers are laid out as four vertical **columns** of ingredients spread
across five walkable **floors**. Every column holds a top bun, lettuce, patty and
bottom bun, and an empty **plate** waits at the bottom of each column.

The chef flips an ingredient by walking all the way across it. A flipped
ingredient falls one floor; if it lands on another ingredient it knocks that one
down too, and the whole stack shuffles a floor lower — so a well-timed walk
cascades several ingredients at once. Ingredients that reach the plate stay
there. Assemble all four burgers (16 ingredients plated) and the level is
cleared; the next level restocks the board with faster, more numerous enemies.

Mr. Hot Dog, Mr. Egg and Mr. Pickle climb the same ladders looking for the chef.
Touching one costs a life. Two ways to fight back:

- **Pepper.** A limited shaker (5 shots) stuns everything in a short cone in
  front of the chef for a few seconds.
- **Falling ingredients.** An ingredient that falls onto an enemy carries it down
  and squashes it, worth far more than pepper — and squashing several enemies
  with one ingredient scores a rising bonus.

## Mechanics

### World

- Canvas is a fixed `640 × 480` play field. All motion is expressed in pixels
  per second and advanced by `step(dt)`, so tests can simulate frames
  deterministically without depending on `requestAnimationFrame` timing.
- Six floor lines (`FLOOR_Y`, index `0` at the top). Floors are walkable across
  their whole width; floor `5` (`PLATE_LEVEL`) is the plate row.
- `LADDERS` is a list of `{ x, gap }` entries, where `gap` *g* connects floor *g*
  to floor *g+1*. Every gap has at least two ladders, and the set is arranged so
  every floor is reachable from every other.
- Four ingredient columns, centred on `COLUMN_X`.

### Actors

The chef and the enemies share one movement primitive (`advanceActor`):

- An actor is either **on a floor** (moving horizontally, clamped to the play
  field) or **climbing** (moving vertically between two floors, x snapped to the
  ladder).
- An actor on a floor starts climbing when its vertical input is non-zero and a
  ladder for that gap is within `LADDER_SNAP` pixels.
- A climbing actor may reverse direction mid-ladder; it snaps to a floor when it
  arrives and becomes floor-bound again.

Enemies steer greedily: match the chef's floor first (walk to the nearest ladder
for the gap that closes the distance, then climb), otherwise walk toward the
chef's x. Stunned enemies do not move.

### Ingredients

Each ingredient tracks four **segments**. The chef pressing a segment is
recorded while he walks over it on the same floor; when all four are pressed the
ingredient flips and falls.

Falling resolution, applied when a faller reaches its target floor:

1. If the target floor is above the plate and another ingredient is resting
   there in the same column, that ingredient is knocked loose (it starts falling
   to the floor below) and the faller keeps going one floor further.
2. Otherwise the ingredient lands. On the plate row it stacks on top of whatever
   is already plated in that column.

Landing scores `POINTS_DROP`. Any enemy the faller overlaps while in flight
rides down with it and is squashed on landing, scoring `POINTS_SQUASH` for the
first enemy and doubling for each additional one carried by the same ingredient.

### Lives, levels and scoring

- 3 lives. Contact with a live, unstunned enemy costs a life and resets the chef,
  the enemies and the pepper shaker; the ingredient layout is left as it was.
- Clearing all four burgers scores a level bonus, then restocks the board with
  faster enemies and a larger enemy cap (`level` increases).
- Best score is persisted in `localStorage` under `burgertime-best`.

## Controls

| Input | Action |
|---|---|
| <kbd>←</kbd> <kbd>→</kbd> or <kbd>A</kbd> <kbd>D</kbd> | walk left / right |
| <kbd>↑</kbd> <kbd>↓</kbd> or <kbd>W</kbd> <kbd>S</kbd> | climb up / down a ladder |
| <kbd>Space</kbd> | throw pepper (also starts the game when idle or over) |
| <kbd>P</kbd> | pause / resume |
| Start button | start or resume |

## Code layout

| File | Purpose |
|---|---|
| `index.html` | HUD, canvas, overlay, help text |
| `style.css` | Diner-neon presentation |
| `game.js` | Constants, state, simulation (`step`), rendering, input |
| `tests/burgertime.spec.js` | Playwright suite driving the exposed globals |

`game.js` is a classic (non-module) script, so its state and helpers are plain
globals reachable from `page.evaluate` — the same convention Kaboom, Snake and
Tetris use in this repo. Test-facing helpers: `startGame()`, `step(dt)`,
`togglePause()`, `setChefInput(dx, dy)`, `placeChef(x, floor)`, `sprayPepper()`,
`spawnEnemy(opts)`, `ingredientAt(col, level)`, `platedCount(col)`,
`columnComplete(col)`.

## Assumptions

Decisions made without a human to ask; the simpler reading was taken each time.

- **Branch name.** The task asked for a branch named after the game
  (`burger-time`), but this session is also pinned to the designated branch
  `claude/loving-euler-aahkhk` and told never to push elsewhere. The designated
  branch wins; the game name lives in the folder, commits and PR title instead.
- **Floors are full-width.** The arcade original has staggered, partial floors.
  Here every floor spans the canvas, which keeps movement and enemy pathing
  simple and the level always solvable.
- **Fixed layout.** One hand-authored floor/ladder/ingredient layout is reused
  every level; difficulty comes from enemy speed, spawn rate and enemy cap
  rather than new geometry.
- **Cascades stop at the plate.** Ingredients already on a plate are never
  knocked loose, so progress is monotonic.
- **The chef cannot ride ingredients.** In the original he can drop with an
  ingredient he is standing on; here a falling ingredient simply ignores him,
  which removes a whole class of ambiguous edge cases.
- **Pepper is a rectangle.** The stun area is an axis-aligned box in front of the
  chef rather than an animated cloud sprite.
- **Enemies are one behaviour.** The three enemy types differ in colour, shape
  and speed multiplier only; none of the original's type-specific tricks
  (Mr. Egg's flight, Mr. Pickle's kick) are modelled.
- **No sound.** Consistent with the rest of the repo.
