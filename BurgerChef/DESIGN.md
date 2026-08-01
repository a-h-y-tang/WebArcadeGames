# Burger Chef — Design

## Concept

A BurgerTime-style platform arcade game. The chef runs along five floors joined
by ladders, walking across burger ingredients to knock them down onto the plates
at the bottom of the screen. Hot dogs, eggs and pickles chase him; a limited
supply of pepper freezes them, and a falling ingredient flattens anything under
it.

Three burgers must be assembled to clear a level. Every level after that keeps
the same board but adds a faster, larger pack of enemies.

## Files

| File | Purpose |
|---|---|
| `index.html` | Canvas, HUD and overlay markup |
| `style.css` | Layout and presentation |
| `game.js` | All game state, simulation and rendering |
| `tests/burgerchef.spec.js` | Playwright suite (63 tests) |

`game.js` is a single classic (non-module) script. Everything lives in the
global lexical scope, which is what lets the Playwright tests read state
(`chef`, `ingredients`, `enemies`, `plates`) and drive the simulation
(`step`, `setChef`, `moveChef`, `sprayPepper`, `spawnEnemy`) directly, the same
way Kaboom, Dino Run and Tetris do in this repo.

## World model

The board is described by three constant arrays:

- `FLOOR_Y = [90, 175, 260, 345, 430]` — the five floor lines, top to bottom.
  The last one, `PLATE_FLOOR`, carries the plates.
- `LADDER_X = [16, 208, 400, 592]` — ladder centre lines. Every ladder spans the
  full height of the board.
- `STACK_X = [32, 224, 416]` — the left edge of each burger column. A column is
  `SEGS` (4) segments of `SEG_W` (32) pixels, so 128 px wide, and no ladder ever
  passes through one.

An ingredient is `{ stack, type, floor, y, flipped[4], falling, targetFloor,
served }`. `type` is its index in `INGREDIENT_TYPES`
(`bunTop, lettuce, patty, bunBottom`) and also the floor it starts on, which is
what gives the opening board its staircase shape.

## Mechanics

### Walking ingredients down

While the chef is standing on a floor line (not on a ladder), `flipSegments()`
finds the segment under him and marks it flipped. When all four segments of an
ingredient are flipped it starts falling to the floor below and scores
`DROP_POINTS`.

### The cascade

Landing is resolved in a batch at the end of each sub-step:

1. Every falling ingredient advances by `FALL_SPEED * h` and is checked against
   the enemies it passes through.
2. Ingredients that reached their target floor are collected into `arrived`.
3. For each cell that received an arrival, if anything was **already resting**
   there, the whole pile — arrivals and residents alike — is knocked down one
   more floor.

The distinction between "arrived together" and "was already resting" is what
makes the cascade terminate. Ingredients that come down as a group stay a group;
only meeting a stationary ingredient pushes the pile further. A clean drop from
the top bun therefore chains all the way to the plate, which is the intended
high-scoring play, while a two-ingredient pile simply comes to rest.

Reaching `PLATE_FLOOR` serves the ingredient: it is pushed onto `plates[stack]`
and drawn stacked on the plate (bottom bun lowest). Four served ingredients
complete a burger; three complete burgers advance the level.

### Movement

`stepChef(h)` gives climbing priority over walking:

- With a vertical intent and a ladder within `LADDER_SNAP` pixels, the chef
  snaps to the ladder centre and moves along it, clamped between the top and
  plate floors.
- With a horizontal intent and both feet within `FLOOR_SNAP` of a floor line,
  the chef walks, clamped to the canvas.
- Coming to rest within `FLOOR_SNAP` of a floor line snaps him onto it and ends
  the climb.

`chef.floor` is always the *nearest* floor (used by the enemy AI to know which
storey to head for), while `chef.climbing` is what gates ingredient flipping —
you cannot flip a segment from halfway up a ladder.

### Enemies

Enemy AI is deliberately greedy and deterministic, so tests do not need a seeded
RNG:

- On the chef's floor: walk straight at him.
- Otherwise: walk to the nearest ladder, then climb one floor toward him.

Touching an unstunned enemy costs a life; `resetActors()` puts the chef back at
the start and rebuilds the enemy pack, leaving the burgers as they were.

A falling ingredient squashes any enemy inside its column, scores
`SQUASH_POINTS`, and the extra weight carries the ingredient one floor further
down. Squashed enemies return from a spawn point after `RESPAWN_DELAY`.

### Pepper

`sprayPepper()` spends one pepper and stuns every live enemy on the chef's floor
within `PEPPER_RANGE` pixels ahead of him for `PEPPER_STUN` seconds. Stunned
enemies stop moving and cannot take a life. A cosmetic cloud is drawn for
`CLOUD_LIFE` seconds. Clearing a level refills one pepper, capped at
`PEPPER_MAX`.

## Simulation

`step(dt)` runs the world in fixed `1/240 s` sub-steps so nothing tunnels
through a floor, an ingredient or an enemy at high frame rates. The
`requestAnimationFrame` loop calls exactly the same `step()` the tests call, so
real-time play and simulated play cannot drift apart. `step()` is a no-op unless
`state === 'running'`, which is what makes pausing correct for free.

Order within a sub-step: chef → flips → ingredients → enemies → collision →
level check.

## Controls

| Input | Action |
|---|---|
| `←` `→` / `A` `D` | Walk |
| `↑` `↓` / `W` `S` | Climb a ladder |
| `Space` | Spray pepper (starts the game when idle or over) |
| `P` | Pause / resume |

## Scoring

| Event | Points |
|---|---|
| Ingredient starts falling (each floor of a cascade) | 50 |
| Enemy squashed | 100 |
| Burger completed | 500 |
| Level cleared | 1000 |

The best score is kept in `localStorage` under `burgerchef-best`.

## Assumptions

The scheduled task that produced this game runs unattended, so ambiguities were
resolved in favour of the simpler option and recorded here.

- **Branch name.** The task asked for a branch named after the game
  (`burger-chef`), but this session is pinned to the branch
  `claude/loving-euler-7jmf6e` and is not permitted to push elsewhere. The work
  was done on the pinned branch; the game folder name carries the identity
  instead.
- **Name.** "BurgerTime" is a Data East trademark, so the game is called Burger
  Chef and uses original art and level layout.
- **Board layout.** One fixed board rather than per-level layouts. Difficulty
  scales through enemy count and speed instead, which keeps level generation out
  of scope.
- **Ladders span the whole board.** Real BurgerTime uses partial ladders. Full
  ladders keep both the movement rules and the enemy pathing trivial to reason
  about and to test.
- **Losing a life does not undo burger progress.** Served ingredients stay
  served and flipped segments stay flipped; only the actors reset. Punishing the
  board as well made the game frustrating without adding depth.
- **Enemies pick the nearest ladder, not the best one.** They can dither at the
  midpoint between two ladders. That reads as clumsy monster behaviour, which
  suits the genre, and it keeps the AI deterministic for tests.
- **Cascades are allowed to chain to the plate.** This is authentic to the
  genre and is the main scoring skill, so it was kept rather than capped.
- **No sound.** Consistent with the other games in this repo.
