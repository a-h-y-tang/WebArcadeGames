# Burger Time — Design

How the code works, what the rules are, and which simplifications were made.

## Concept

A single-screen, grid-based arcade game inspired by the 1982 Data East classic.
Chef Pepper runs along five platforms connected by ladders. Walking the full
length of a burger ingredient knocks it down one level; knock every ingredient
of a column onto the plate at the bottom and the burger is built. Four burgers
built clears the level.

Three food enemies (a hot dog, a fried egg and a pickle) hunt the chef along the
same platform/ladder lattice. Touching one costs a life. The chef fights back
with a limited supply of pepper, which stuns anything caught in the cloud, and
with falling ingredients, which squash any enemy standing on them.

## Board geometry

Everything is derived from a tile lattice, so the layout is data rather than
hard-coded pixels.

| Constant | Value | Meaning |
|---|---|---|
| `TILE` | 30 | tile size in px |
| `COLS` × `ROWS` | 21 × 16 | canvas is 630 × 480 |
| `FLOOR_ROWS` | `[2, 5, 8, 11, 14]` | tile rows carrying a walkable platform |
| `LADDER_COLS` | `[0, 5, 10, 15, 20]` | tile columns carrying a ladder |
| `PLATE_ROW` | 14 | bottom platform — the plates live here |
| `BURGER_COLS` | `[1, 6, 11, 16]` | left tile column of each burger stack |
| `INGREDIENT_TILES` | 4 | an ingredient is four tiles (120 px) wide |

The five platforms span the full width and every ladder runs the full height, so
the lattice is a complete 5 × 5 grid of intersections. `floorY(row)` and
`ladderX(col)` convert lattice coordinates to pixels; the platform *walk line*
(`floorY`) is where feet, ingredients and enemies are anchored.

Each burger starts with four ingredients — bottom bun on row 11, patty on row 8,
lettuce on row 5, top bun on row 2 — so a fully assembled burger reads
bottom-up in the right order once everything reaches the plate.

## Movement

The chef and the enemies share one movement model (`moveEntity`):

- **Horizontal** movement is legal when the entity is within `SNAP_TOL` of a
  platform walk line. Moving snaps `y` exactly onto that line, so a walker never
  drifts off the lattice.
- **Vertical** movement is legal when the entity is within `SNAP_TOL` of a
  ladder centre line, and snaps `x` onto it. Climbing is clamped between the top
  and bottom platform.

`moveChef(dx, dy)` only records a *desired* direction; the direction is applied
during `step()` when it is legal, which is what makes "press up a little early
while running at a ladder" feel right.

## Ingredients

An ingredient is `{ burger, col, row, y, type, segs[4], state }`. `segs` tracks
which of its four tiles the chef has trodden on.

1. While the chef walks a platform, any ingredient on that same walk line whose
   x-span contains the chef gets the corresponding `segs` entry set.
2. When all four segments are set the ingredient enters `state: 'falling'`.
3. A falling ingredient descends at `FALL_SPEED` to the **next platform row
   below** — one level, never further.
4. On landing:
   - if the destination is `PLATE_ROW`, the ingredient joins that burger's plate
     stack (stacked upward, `INGREDIENT_H` per layer) and is finished for good;
   - otherwise, if another ingredient of the same burger is resting there, that
     one is knocked down (recursively, one level) and the arriving ingredient
     takes its place. Its `segs` are cleared, so it must be walked again.

That one-level-per-landing rule is the real arcade behaviour: knocking the top
bun onto a column pushes the whole column down exactly one level, so a burger is
assembled over several passes rather than in a single drop.

Any enemy overlapping a falling ingredient is squashed (points, then a delayed
respawn). Falling ingredients are harmless to the chef.

## Enemies

Enemies walk the same lattice at `enemySpeed()` (scales with level). At every
lattice *intersection* — aligned to both a walk line and a ladder — the enemy
re-picks a direction: it scores every legal option by the resulting distance to
the chef and takes the best, with a small random chance of taking a different
one so a level does not play out identically twice. Reversing is only allowed
when it is the sole option, which stops the jittering that pure greedy chasing
produces.

A stunned enemy (`stun > 0`) stands still. A squashed enemy is removed and
re-spawned at a spawn point after `RESPAWN_DELAY`.

## Pepper

`usePepper()` spends one pepper and creates a short-lived cloud rectangle in
front of the chef. Every enemy overlapping the cloud while it lives is stunned
for `STUN_TIME`. Peppers are replenished at the start of each level.

## Scoring

| Event | Points |
|---|---|
| Ingredient lands (any level) | 50 |
| Enemy squashed by an ingredient | 100 |
| Burger completed | 500 |
| Level cleared | 1000 × level |

The best score is persisted in `localStorage` under `burgertime-best`.

## Code layout

`game.js` is a single classic (non-module) script, matching Kaboom, Snake and
the other games in this repo: state lives in plain globals so the Playwright
tests can drive and inspect the simulation directly through `page.evaluate`.

- Constants and lattice helpers (`floorY`, `ladderX`, `nearestFloorRow`, …)
- Board setup (`buildIngredients`, `spawnEnemies`, `startGame`, `nextLevel`)
- Simulation: `substep(h)` → `step(dt)`; `step` runs fixed 1/240 s sub-steps so
  collisions and lattice snapping are frame-rate independent and deterministic
  under test.
- Game flow: `loseLife`, `completeLevel`, `endGame`, `togglePause`
- Rendering: `draw()` — pure function of state, never mutates it
- Input: keyboard handlers that call the same API the tests use

`step(dt)` is the single entry point for advancing the world, so tests never
depend on `requestAnimationFrame` wall-clock timing.

## Controls

| Key | Action |
|---|---|
| ← → ↑ ↓ / A D W S | Run and climb |
| Space | Throw pepper (also starts / advances the game) |
| P | Pause / resume |
| Enter | Start / restart |

## Assumptions

Decisions taken autonomously where the brief was open-ended; the simpler
interpretation was preferred throughout.

1. **Branch name.** The task asked for a branch named after the game
   (`burger-time`), but this session is required to develop on
   `claude/loving-euler-6d2lz8`. The session branch wins; the game name is
   carried by the folder and commit messages instead.
2. **Full-width platforms and full-height ladders.** The arcade board has ragged
   platforms and partial ladders. A complete lattice keeps enemy pathing and the
   fall rules simple and predictable, at a small cost in level variety.
3. **One level layout.** Later levels reuse the same board with faster enemies
   and one extra enemy (capped at 5) rather than introducing new maps.
4. **Falling ingredients do not carry the chef.** In the arcade the chef can
   ride a falling piece. Here a falling piece simply ignores the chef — it
   neither hurts nor transports him.
5. **Enemies are squashed, not stacked.** A squashed enemy disappears and
   respawns; there is no "enemy trapped in the burger" bonus scoring.
6. **No bonus items** (coffee, ice cream) and no per-level bonus timer.
7. **Points are awarded per landing** (50) rather than per level dropped, which
   keeps scoring legible without tracking drop chains.
8. **Board state survives death.** Losing a life resets the chef and enemies but
   keeps the ingredients where they are, so a life is not a full restart.
