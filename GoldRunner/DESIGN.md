# Gold Runner — Design

## Concept

Gold Runner is a single-screen, ladder-and-rope platform puzzler in the spirit of
the 1983 arcade classic *Lode Runner*. You are a treasure hunter trapped in an
underground vault with the guards who own it. Collect every bar of gold on the
screen, then climb the escape ladders that appear at the top of the vault to
reach the surface and move on to the next level.

You cannot jump and you cannot fight. Your only tool is a laser drill that bores
a hole through the brick floor diagonally in front of you. A hole is a trap: a
guard that walks into one is stuck for a few seconds, and if the brick knits
itself back together while the guard is still inside, the guard is crushed. The
same is true of you — dig carelessly, stand in your own hole, and the level ends
with a life lost.

Every level is one screen, so the whole puzzle is visible at once. The tension
comes from route planning under pressure: which brick to open, in which order to
sweep the gold, and where to be standing when the guards converge.

## Board

The vault is a 24 × 14 grid of 30 px tiles (720 × 420 canvas).

| Char | Tile | Behaviour |
|---|---|---|
| `.` | empty | passable; nothing supports you |
| `#` | brick | solid, **diggable** |
| `@` | stone | solid, cannot be dug (used for the vault floor) |
| `H` | ladder | climb up/down, and stand on |
| `-` | rope | hang from and traverse sideways; drop by pressing down |
| `S` | escape ladder | invisible and inert until all gold is taken, then a ladder |
| `$` | gold | collect by moving through it |
| `P` | player start | becomes empty floor once parsed |
| `G` | guard start | becomes empty floor once parsed |

Three hand-authored levels ship with the game and repeat with faster guards once
level 3 is cleared. Bricks sit on rows 4, 7 and 10 with a stone floor on row 13,
so each level is four "storeys" joined by staggered ladders and ropes.

## Movement model

Both the player and the guards use the same cell-to-cell movement model: an
entity is either resting exactly on a grid cell or *in transit* along one axis
to an adjacent cell. Movement is smooth (position is a float in tile units), but
every rule — support, blocking, digging, gold pickup — is only ever evaluated at
whole-cell boundaries. That keeps the physics decidable and the tests
deterministic.

An entity resting on cell `(c, r)` is **supported** when any of these holds:

- the cell it stands on is a ladder (or an active escape ladder), or
- the cell it stands on is a rope (it hangs), or
- the cell below is solid, or is a ladder you can stand on top of, or
- it is on the bottom row.

Unsupported entities fall: gravity queues a one-cell downward move each frame
until something supports them. A falling entity ignores steering, which is why
walking off a ledge commits you to the drop. Falling entities are caught by ropes
they pass through.

Legal moves from a resting cell:

- **left / right** — needs support and a non-solid destination.
- **up** — needs the current cell to be a ladder and a non-solid cell above.
- **down** — needs a non-solid cell below. If that cell is a ladder it is a
  climb; otherwise it is a deliberate drop (and from a rope, letting go).

Speeds are expressed in tiles per second (`RUN_SPEED`, `CLIMB_SPEED`,
`FALL_SPEED`, `GUARD_SPEED`) and every update runs through `step(dt)`, so the
Playwright specs can advance the simulation frame by frame without depending on
`requestAnimationFrame` wall-clock timing.

## Digging

`dig(-1)` / `dig(+1)` bores the brick diagonally below the player. It succeeds
only when all of these hold:

- the player is resting on a cell (not mid-move, not falling),
- the player is not on a ladder or a rope (you need footing to drill),
- the target cell is a `#` brick — stone `@` is immune,
- the cell beside the player, directly above the target, is not solid, and
- the dig cooldown has expired.

The brick becomes empty and a hole is recorded. After `HOLE_TIME` seconds it
knits back:

- a **guard** still inside is crushed — worth points — and respawns at its start,
- the **player** still inside is crushed and loses a life.

A guard that falls into a hole is stuck for `GUARD_TRAP_TIME`, then climbs out to
the cell above. Trapped and climbing guards cannot hurt the player, so the hole
is both a weapon and a bridge you can run over.

## Guards

Guards path toward the player with a breadth-first search over the same movement
graph the player uses, re-planned each time a guard settles on a cell. BFS is
cheap here (24 × 14 = 336 cells) and produces guards that use ladders and ropes
intelligently rather than sliding along one axis. Guards obey gravity, so a hole
in their path reliably swallows them.

Guard speed rises with the level but is capped strictly below the player's run
speed, so a level is always survivable by running.

## Controls

| Input | Action |
|---|---|
| `←` `→` or `A` `D` | run / traverse a rope |
| `↑` `↓` or `W` `S` | climb a ladder, drop from a rope |
| `Z` or `,` | dig down-left |
| `X` or `.` | dig down-right |
| `Space` / `Enter` | start, or restart after game over |
| `P` | pause |

## Scoring

| Event | Points |
|---|---|
| Gold bar | 250 |
| Guard crushed in a hole | 75 |
| Level cleared | 1500 |

Best score is kept in `localStorage` under `goldrunner-best`.

## Files

| File | Contents |
|---|---|
| `index.html` | HUD, canvas, overlay, control legend |
| `style.css` | Vault-themed dark palette shared by HUD and overlay |
| `game.js` | Whole game as one classic (non-module) script; all state and helpers are plain globals so the Playwright specs can reach them |
| `tests/goldrunner.spec.js` | Playwright suite (written first, TDD) |

## Assumptions

These are the calls made where the brief or the source material was ambiguous.
The rule used throughout was "pick the simpler interpretation".

1. **Branch name.** The task asks for a branch named after the game
   (`gold-runner`), but the session's standing instruction is to develop and push
   only on `claude/loving-euler-v2qert`. The standing instruction wins; the game
   name lives in the folder, the commits and the PR title instead.
2. **Guards ignore gold.** In the original, guards pick gold up and drop it when
   they climb out of a hole. Here gold is only ever collected by the player, so
   `goldLeft` is unambiguous and the level can never be made unwinnable.
3. **Digging is instantaneous** (with a short cooldown) rather than an animated
   dig that can be interrupted.
4. **Dying restarts the whole level**, gold included, as in the original —
   rather than resuming from partial progress.
5. **The player is never trapped in a hole.** Falling into your own hole is
   allowed and you can walk out sideways if there is room; the danger is the
   brick knitting back over you.
6. **Guards do not collide with each other** and may overlap. Modelling guard
   queues added complexity without changing how the game plays.
7. **Falling entities are caught by ropes** they fall through, which makes ropes
   useful as safety nets and keeps the fall rules to a single support test.
8. **Three hand-authored levels** repeat indefinitely with faster guards instead
   of generating new layouts, so every level is guaranteed solvable. A spec
   asserts, by flood-filling the movement graph, that every gold bar and the
   escape row are reachable from the player's start.
9. **The escape ladders are drawn only once all gold is taken.** They are inert
   (plain empty space) before that, so they cannot be used as a shortcut.
