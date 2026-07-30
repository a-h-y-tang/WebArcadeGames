# BurgerTime — Design

A single-screen platform-and-ladder arcade game on an HTML5 canvas. The player
is a chef trapped on a lattice of girders and ladders; walking the length of a
burger ingredient makes it drop to the girder below, and dropping every
ingredient onto the plates at the bottom of the screen builds the burgers and
clears the level. Roaming food enemies chase the chef; a limited supply of
pepper stuns them.

## Game concept

* Three burger **lanes** run down the screen. Each lane holds four ingredients —
  top bun, lettuce, patty, bottom bun — resting on four of the five girders.
* Each ingredient is split into **four sections**. Walking over a section
  presses it down. When all four sections of an ingredient are pressed, the
  ingredient falls to the next girder below.
* An ingredient that lands on another ingredient knocks it loose: both keep
  falling. A single well-timed drop can cascade a whole lane onto the plate.
* Enemies caught underneath a falling ingredient are squashed (500 points) and
  respawn a few seconds later.
* Touching an enemy costs a life. Pepper (five shots to start, one more per
  level) freezes any enemy in the cloud for a few seconds; frozen enemies are
  harmless.
* Plating every ingredient clears the level. The next level is faster and adds
  another enemy.

## World geometry

All geometry derives from a single tile size so the layout stays consistent.

| Constant | Value | Meaning |
|---|---|---|
| `TILE` | 32 | pixel size of one grid cell |
| `COLS` × `ROWS` | 16 × 16 | canvas is 512 × 512 |
| `FLOOR_ROWS` | `[2, 5, 8, 11, 14]` | girder rows; actors walk on `rowY(row)` |
| `PLATE_ROW` | 14 | bottom girder, where the plates sit |
| `LANES` | `[1, 6, 11]` | left column of each burger lane |
| `INGREDIENT_COLS` | 4 | lane width in tiles (128 px) |
| `LADDERS` | cols 0, 5, 10, 15 | vertical runs, some only partial |

Ladders sit in the gaps between lanes, so a ladder is never hidden underneath
an ingredient. Two of the four ladders are partial (`col 5` stops at row 11,
`col 10` starts at row 5), which forces some routing rather than letting every
climb be a straight line. The full-height ladder in column 0 guarantees every
girder is reachable.

## Movement model

Actors (the chef and the enemies) share one movement routine, `moveActor()`:

* **Walking** is allowed when the actor's feet are within `SNAP` pixels of a
  girder line. The actor snaps onto the line and moves horizontally, clamped to
  the canvas.
* **Climbing** is allowed when the actor is within `SNAP` pixels of a ladder's
  centre column and the ladder's span covers the requested direction. The actor
  snaps onto the ladder centre and moves vertically, clamped to the span.
* Vertical input wins over horizontal when both are legal, which makes ladders
  easy to grab at intersections.

Positions are continuous pixels, not grid cells, and every update is expressed
per second and applied through `step(dt)`. Tests therefore drive the simulation
by calling `step()` directly instead of waiting on `requestAnimationFrame`.

## Ingredients

An ingredient is `{ lane, type, row, x, y, sections[4], falling, onPlate }`.

* `stepSections()` runs after the chef moves: if the chef is walking (not
  climbing) on the girder an ingredient rests on, the section under the chef's
  centre is marked pressed.
* When all four sections are pressed, `startFall()` clears the sections and
  sends the ingredient to the next girder below.
* While falling, the ingredient's rectangle is tested against every live enemy —
  overlaps are squashed.
* On arrival at a girder, if another ingredient is resting there it is knocked
  loose (`startFall()`) and the falling ingredient continues to the girder below
  that one. Otherwise it rests. Either way the drop scores 50 points.
* On arrival at `PLATE_ROW` the ingredient joins the lane's plate stack; each
  stacked layer sits `LAYER_H` pixels above the previous one.

## Enemies

Enemies are greedy chasers rather than full pathfinders. At a **node** — a point
where the actor is both on a girder line and at a ladder centre — an enemy
re-picks its direction:

1. Enumerate the legal moves (walk left/right, climb up/down).
2. Score each by the straight-line distance to the chef after a probe step.
3. Take the best, except that a seeded RNG picks a random legal move
   `TURN_NOISE` of the time so enemies do not move as one block.
4. Reversing is only considered when nothing else is legal.

The RNG is a seeded xorshift (`seedRng()`), so a test can fix the seed and get
identical enemy behaviour every run.

Enemies never overlap-kill while `stun > 0` (peppered) or while `squashed`.
Squashed enemies disappear and return at a spawn point after `RESPAWN_TIME`.

## Game states

`state` is one of `idle`, `running`, `paused`, `dying`, `levelclear`, `over`.

* `dying` runs a short timer, then either respawns the actors or ends the game.
* `levelclear` runs a short timer, then builds the next level.

Ingredient progress survives losing a life — only positions reset.

## Controls

| Input | Action |
|---|---|
| `←` `→` / `A` `D` | walk |
| `↑` `↓` / `W` `S` | climb |
| `Space` | throw pepper (also starts / restarts the game) |
| `P` | pause / resume |
| Start button | start the game |

## Scoring

| Event | Points |
|---|---|
| Ingredient lands on a girder or plate | 50 |
| Enemy squashed by a falling ingredient | 500 |
| Level cleared | 1000 × level |

The best score is persisted in `localStorage` under `burgertime-best`.

## Code layout

* `index.html` — HUD, canvas, overlay. No build step; open it directly.
* `style.css` — diner-counter styling, shared visual language with the rest of
  the repo (dark chrome, neon accent, rounded HUD chips).
* `game.js` — a single classic (non-module) script, matching Kaboom, Snake and
  Tetris in this repo, so every constant, state variable and function is a plain
  global the Playwright tests can reach with `page.evaluate()`.
* `tests/burgertime.spec.js` — the Playwright suite, written before the
  implementation.

## Assumptions

Written up front because this game was built autonomously; where the original
arcade game is ambiguous or expensive to reproduce, the simpler reading was
taken.

1. **Branch name.** The task asked for a branch named after the game
   (`burger-time`), but the session's standing git instructions pin all work to
   `claude/loving-euler-oxz8n7`. The pinned branch wins; the game name lives in
   the folder, commit and PR title instead.
2. **Falling ingredients are harmless to the chef.** In the arcade game the chef
   can ride a falling ingredient. Riding is not modelled: falling ingredients
   pass through the chef.
3. **Squashed enemies vanish immediately** rather than riding the ingredient
   down as a flattened sprite. They respawn at a spawn point after a few
   seconds.
4. **One layout for every level.** Levels get faster and add an enemy instead of
   changing the girder plan; that keeps the level geometry test-stable.
5. **Enemies are one visual family with per-index colours** (hot dog, egg,
   pickle) but identical behaviour. The arcade game gives each type slightly
   different speed and aggression; that is folded into the shared speed curve.
6. **Pepper is a rectangular cloud in front of the chef**, not an animated
   projectile.
7. **No sound.** The rest of the repo's games are silent, so this one is too.
8. **Level clear is automatic** after a short celebratory pause rather than a
   bonus round or interstitial screen.
