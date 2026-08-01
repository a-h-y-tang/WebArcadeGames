# Burger Time — Design

## Concept

A single-screen platform arcade game inspired by the 1982 Data East classic.
The player is a chef trapped on a lattice of floors and ladders. Four burgers
hang in pieces across the level; walking the full length of an ingredient makes
it drop to the floor below, and once every piece of a burger has fallen onto its
plate the burger is built. Build all four burgers to clear the level.

Roaming food enemies (hot dog, egg, pickle) hunt the chef. The chef's only
defence is a finite supply of pepper, which briefly stuns anything in front of
him, and the ingredients themselves — an enemy standing on a piece that starts
to fall is squashed and rides it down.

## World geometry

The level is a fixed lattice, not a tile map:

| Element | Values |
|---|---|
| Canvas | 600 × 500 |
| Floors | y = 80, 150, 220, 290, 360, 430 (6 platforms, each spanning the full width) |
| Ladders | x = 20, 160, 300, 440, 580 (5 ladders, each connecting **every** adjacent pair of floors) |
| Burger columns | x = 40, 180, 320, 460 — each 100 px wide |
| Plates | y = 470, one under each column |

Every burger has four ingredients (top bun, lettuce, patty, bottom bun) that
start on floors 0–3 of their column. Each ingredient is split into
`SEGMENTS = 4` horizontal segments of 25 px.

Positions are stored as floats and advanced by `step(dt)`, so the tests can
simulate frames deterministically without depending on `requestAnimationFrame`.
An actor's `y` is the floor line it stands on; an ingredient's `y` is the line
its underside rests on.

## Mechanics

**Movement.** An actor may move horizontally only while standing on a floor
(within `SNAP` of a floor line, at which point `y` snaps to that line), and
vertically only while aligned with a ladder (`x` snaps to the ladder). Vertical
intent wins when both are legal. Illegal input simply doesn't move the actor.

**Flipping.** During `step`, any ingredient segment the chef currently overlaps
while standing on that ingredient's floor is pressed down. When all four
segments of an ingredient are down, it starts falling.

**Falling and stacking.** A falling ingredient descends at `FALL_SPEED`. If it
reaches a resting ingredient in the same column, that ingredient is knocked
loose and starts falling too (the classic chain drop). Ingredients land on the
plate in the order they arrive: the *n*-th piece to land in a column rests at
`PLATE_Y - n * ING_H`. A column is finished when all four of its pieces have
landed; when all four columns are finished the level is complete.

**Enemies.** Enemies use greedy chase logic evaluated only when they are
standing on a floor: if the chef is on a different floor they head for the
nearest ladder and climb toward him, otherwise they walk straight at him. While
climbing they keep their current direction until they reach the next floor.
Touching the chef costs a life; being overlapped by a falling ingredient
squashes the enemy (score, and it is removed). Enemies respawn from a fixed,
deterministic rotation of spawn points, up to a per-level concurrent cap.

**Pepper.** `sprayPepper()` spends one shaker and stuns every enemy inside a
rectangle extending `PEPPER_RANGE` px in the chef's facing direction on the
chef's floor. Stunned enemies are frozen for `STUN_TIME` seconds.

**Scoring.** 50 per ingredient landed, 100 per enemy squashed (rising by 100 for
each extra enemy the same piece catches), 500 for clearing a level. The best score is persisted to `localStorage` under `burgertime-best`.

**Lives.** Three. A death resets the chef and enemies to their starting
positions but keeps burger progress; losing the last life ends the game.

**Difficulty.** Each level speeds enemies up, raises the concurrent-enemy cap
(to a maximum of 5) and grants one extra pepper.

## Controls

| Key | Action |
|---|---|
| ← / A | Walk left |
| → / D | Walk right |
| ↑ / W | Climb up |
| ↓ / S | Climb down |
| Space | Start / restart, and spray pepper while playing |
| P | Pause / resume |

## Assumptions

These ambiguities were resolved toward the simpler reading and are recorded
here per the task instructions.

- **Branch name.** The task asked for a branch named after the game
  (`burger-time`), but this session's standing git instructions designate
  `claude/loving-euler-pihbga` as the branch to develop and push to, and forbid
  pushing elsewhere. The designated branch wins; the game name is carried by the
  folder and commit message instead.
- **Level geometry is fixed.** Every floor spans the full width and every ladder
  connects every adjacent floor pair, rather than the original's irregular,
  partially connected lattice. This keeps the level fully connected and the
  movement rules to two cases.
- **Flipping is overlap-based.** Standing on a segment presses it down; the
  original requires a continuous walk across the piece. Overlap is simpler to
  reason about and to test, and plays nearly identically because the chef has to
  cross the whole piece anyway to reach all four segments.
- **Falling pieces don't hurt the chef.** In the arcade the chef can be crushed;
  here only enemies are affected, so the drop is a pure reward.
- **No death animation.** Losing a life immediately resets positions rather than
  playing an animation and pausing the simulation.
- **No randomness.** Enemy spawn points cycle through a fixed list instead of
  being chosen randomly, so the whole simulation is deterministic and reproducible
  under test. `Math.random` is never called.
- **One layout for all levels.** Later levels change enemy speed, enemy count
  and pepper supply, but reuse the same burger layout.

## File map

| File | Contents |
|---|---|
| `index.html` | HUD, canvas, overlay, help text |
| `style.css` | Diner-inspired dark theme |
| `game.js` | Whole game: constants, level build, `step(dt)`, rendering, input |
| `tests/burgertime.spec.js` | Playwright suite driving `step(dt)` and the globals |

`game.js` is a classic (non-module) script, so all state and helpers are
reachable from `page.evaluate` as plain globals — the same convention used by
Kaboom, Dino Run, Snake and Tetris in this repo.

## Testing

The Playwright suite (62 tests) was written before the implementation and drives
the simulation directly rather than through the render loop: it calls
`startGame()`, positions actors with `placeChef()` / `spawnEnemyAt()`, and
advances time with explicit `step(0.016)` calls.

Two helpers exist for the tests: `placeChef(x, y)` teleports the chef onto a
spot, and `clearEnemies()` empties the board and holds off the next spawn so a
long simulation can measure one rule in isolation (without it, a test that
simulates ten seconds of movement is legitimately interrupted by an enemy
catching the chef).

Beyond the per-rule tests, a `long run` group simulates a full minute of play
with a bot chef and asserts the invariants that unit tests can't see: every
actor stays inside the lattice, the enemy count never exceeds the level cap, the
piece count stays at 16 across level rebuilds, and no plate ever holds more than
four pieces.
