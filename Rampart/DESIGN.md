# Rampart — Design

## Game concept

A siege game in three repeating phases, played on one screen. You hold a castle
on a stretch of coast. A fleet stands off the shore and shells your stonework;
your cannons shell it back. The twist is what happens between the fighting: your
walls are not a health bar, they are a *shape*. At the end of every round the sea
floods in through any gap, and a castle the flood can reach is lost. Keeping a
castle is literally a matter of drawing a closed line around it with the wall
pieces you are handed.

Each round runs:

1. **Place** (10 s) — drop 2 × 2 cannons anywhere inside the ground you enclose.
2. **Battle** (30 s) — the fleet sails in and shells you; you fire back by
   clicking (or aiming with the keyboard). Every loaded cannon in range answers a
   single order, so a big courtyard full of guns fires a real volley.
3. **Repair** (25 s, shrinking with each round) — you are dealt wall pieces,
   tetromino-shaped, one at a time. Place them on open land to close the holes
   the shelling opened.

At the end of repair the board is flood-filled from its border. Every castle the
flood cannot reach survives and pays a bonus; if the flood reaches all three, the
siege is over.

Nothing else in this repo works this way. `TowerDefense` places static towers
along a fixed path, `Xonix` claims area by drawing a trail, and `Tetris`/`Columns`
drop pieces into a well. Rampart is the only game here where the pieces you place
are judged by *enclosure* — a wall is worth nothing until it forms a closed loop,
and one missing cell undoes a whole ring.

## World geometry

Everything is derived from a tile grid, so the layout is easy to reason about and
easy to assert on in tests.

| Constant | Value | Meaning |
|---|---|---|
| `COLS` × `ROWS` | 28 × 22 | grid size |
| `CELL` | 20 px | one grid cell |
| `CANVAS_W` × `CANVAS_H` | 560 × 440 px | `COLS * CELL` × `ROWS * CELL` |
| `SHORE_MIN` / `SHORE_MAX` | 7 / 9 | the coastline wanders between these columns |
| `CASTLE_SIZE` | 3 | castles are 3 × 3 |
| `CANNON_SIZE` | 2 | cannons are 2 × 2 |
| `RING` | cols 10–18, rows 6–14 | the 9 × 9 wall you start with |

Two parallel grids describe the board:

- `terrain[row][col]` — `WATER` or `LAND`. Sea to the left of `shore[row]`, land
  to the right. The coastline is a seeded sine swell plus noise, so it is ragged
  but always leaves the whole play area buildable.
- `structures[row][col]` — `EMPTY`, `WALL`, `CASTLE` or `CANNON`.

A third grid, `rubble[row][col]`, is cosmetic bookkeeping: it marks where
stonework was blown away so the repair phase can show you the scars.

Three castles sit in a column at cols 13–15, rows 1–3, 9–11 and 17–19. Only the
middle one starts ringed by wall, so round 1 begins with exactly one castle held
and a 7 × 7 courtyard to put cannons in. Walling in the other two is the way to
grow: more castles held means more cannons per round and a bigger bonus.

## Enclosure: the one rule everything hangs on

`computeOutside()` flood-fills the grid from every border cell, moving through
anything that is not a `WALL` — water, open ground, castles and cannons all let
the flood through. What it reaches is `outside`; what it cannot reach is yours.

Two things read that result:

- `isEnclosed(castle)` — true when no cell of the castle's 3 × 3 block was
  reached. This is the survival test at the end of each repair phase.
- `countTerritory()` — enclosed, empty **land**: the ground a cannon may stand
  on. Water inside a ring stays unbuildable, which is why a ring drawn across a
  bay is worth less than one drawn inland.

Because the flood only stops at walls, a single missing cell anywhere in a ring
un-encloses everything inside it. That is the whole game in one sentence.

## Phases

`phase` is `'place' | 'battle' | 'repair'` and `phaseTime` counts down in
`step(dt)`. When it hits zero, `endPhase()` hands over to the next phase; the
tests call `endPhase()` directly to jump around.

**Place.** `beginPlace()` recomputes enclosure and grants `2 + heldCastles()`
cannons. `placeCannon(col, row)` accepts a 2 × 2 footprint only when every cell is
in bounds, on land, empty and *not* outside. The cursor previews the footprint in
green or red, and enclosed ground is tinted so you can see what you actually hold.

**Battle.** Ships spawn in the sea on a timer (`shipsForRound(round)` of them, at
most `SHIP_MAX_ALIVE` at once), sail east and anchor `SHIP_STOP_GAP` px off the
coast. They only open fire once they are on station, which gives a gunner a real
window to sink them before they do any damage. Each shell is aimed at a wall or
cannon cell near the ship's own row, with a few pixels of scatter so repeated
hits spread into a crater instead of drilling one hole.

`fireAt(x, y)` orders every cannon that is loaded and within `CANNON_RANGE` to
fire at the same point, then puts each on a `CANNON_COOL` reload. Shots are not
simulated as ballistics: a shot stores its start, its target and a duration
(`distance / speed`), and draws itself along a sine arc. It explodes when the
clock runs out, so a shell always lands where it was aimed.

`explode(x, y, side)` is the only thing that damages the board. It clears `WALL`
cells whose centre is within `BLAST_R` — which, with a 20 px cell and an 18 px
radius, means the cell it lands on plus its four orthogonal neighbours. Enemy
fire also knocks out cannons; your own fire does not, but it *does* take out your
own walls, so shooting over your ramparts at a ship behind them has a cost.

**Repair.** `dealPieces()` draws from a shuffled bag of eight shapes (the seven
tetrominoes plus a single-cell `dot` for plugging pinholes), showing the current
piece under the cursor and the next one in a corner box. `placePiece(col, row)`
requires every cell to be in bounds, on land and empty — pieces never overlap
existing wall, so a one-cell gap really does need the `dot` or a detour around
it. `rotatePiece()` maps `(c, r) → (-r, c)` and re-normalises to the origin, so
four rotations return the original shape.

**Checkpoint.** `checkpoint()` runs at the end of repair: flood-fill, count held
castles, and either score `CASTLE_BONUS` per castle and start the next round, or
end the game.

## Simulation and determinism

All motion is expressed per second and advanced through `step(dt)`, which does
nothing unless `state === 'running'`. The `requestAnimationFrame` loop calls
`step(dt)` and then `draw()`.

Two test seams keep the specs honest:

- `shipSpawnEnabled` — turns the fleet's own spawn timer off so a spec can place
  exactly the ships it wants to reason about.
- `autoStep` — detaches the animation loop from the simulation, so a spec advances
  time itself (`step(1/60)` in a loop) and the real clock never races it. One
  spec deliberately leaves it on to prove the loop runs.

Randomness goes through a seeded mulberry32 (`setSeed`/`rand`), re-seeded on every
`startGame()`, so the coastline, the piece bag and the fleet's aim repeat exactly.

The whole game is one classic (non-module) script, matching BurgerTime, Snake and
Tetris in this repo: state and helpers are plain globals, which is what lets the
Playwright specs read `structures`, call `endPhase()` and assert on the result.

## Rendering

`draw()` paints, in order: sea (with a drifting swell), land (faint checker plus
seeded scenery), the enclosed-ground tint during placement, rubble scars, walls,
castles, cannons, ships, shots, blasts, the cursor preview, the next-piece box and
a phase banner. Castles are gold while held and grey once the sea can reach them,
which makes the flood-fill result readable at a glance. The HUD (score, round,
phase, clock, cannons left, best) lives in the DOM rather than the canvas.

## Testing

`tests/rampart.spec.js` holds 104 Playwright specs, grouped by concern: page
shell, board layout, enclosure, starting a run, the phase clock, cannon
placement, ships, firing, the repair phase, round progression, pause, input and
rendering. They were written before the implementation and drove it: the
enclosure specs in particular (breach the ring → castle lost; seal it → castle
held) pinned down the flood-fill contract before any of it existed.

Run them with `npx playwright test Rampart/tests/` from the repo root.

## Assumptions

The task description left a few things open. Where it did, the simpler reading
won:

- **One branch.** The task asked for a branch named after the game; the session's
  standing instructions pin all work to a designated branch. The designated
  branch wins, so this game was developed and pushed there rather than on a
  `rampart` branch.
- **Simplified Rampart.** The arcade original has enemy troops landing on the
  beach to build their own walls, multiple map layouts and a two-player mode.
  This version keeps the three-phase loop, the enclosure rule and the cannon
  volley, and leaves the landing parties out. One map, one player.
- **Castles are indestructible.** Shells knock out walls and cannons but never the
  castle itself. You lose a castle by failing to enclose it, not by having it
  shot away — which keeps the enclosure rule the only thing that matters.
- **Cannons persist between rounds.** The original clears guns that end up
  outside your territory. Here a cannon stays until enemy fire destroys it; the
  per-round allowance (`2 + castles held`) is what limits the battery.
- **Ships do not collide or overlap.** They are independent; two may share a
  latitude band. With at most three alive at once this never looked wrong enough
  to be worth the extra rule.
- **No lives.** Losing every castle ends the run immediately, as in the original.
  Best score is kept in `localStorage` under `rampart-best`.
