# Burger Time — Design

A canvas arcade game in the spirit of the 1982 platform classic. The player is a
chef who walks along girders and climbs ladders, treading on burger ingredients
to knock them down onto the plates below, while dodging the food enemies that
hunt them across the level.

## Game concept

Four burgers hang in mid-air, split into ingredient layers spread across four
platform rows. Walking the full width of an ingredient makes it fall one level.
Ingredients that land on other ingredients shove them down too, so a well-timed
walk can cascade a whole stack onto its plate. Assemble all four burgers to clear
the level. Three lives; enemies cost one on contact; five shots of pepper per
level stun them for a few seconds.

## Layout

The level is a 21 × 15 grid of 32 px tiles (canvas 672 × 480), described by an
ASCII map in `game.js`:

| char | meaning |
|---|---|
| `-` | girder — the walking surface is the **top edge** of the cell |
| `\|` | ladder occupying the cell |
| `+` | both: a ladder passing down through a girder |
| `.` | empty air |

Five girder rows run the full width at grid rows 2, 5, 8, 11 and 14; row 14 is
the plate row. Ladder columns sit at grid columns 0, 5, 10, 15 and 20, but only
some segments are present between each pair of girders, so routes between floors
are asymmetric and the enemies have to commit to a side.

Contiguous runs of ladder cells in a column are precomputed at load into
`LADDER_SEGMENTS` (`{ col, cx, topY, bottomY }`). A segment can span more than
one girder row — the middle ladder runs unbroken from row 5 to row 14 — which is
exactly the behaviour you want: you may step off at any girder it passes.

## Mechanics

### Movement

Both the player and the enemies move through one pure helper:

```js
attemptMove(x, y, dx, dy, dist) -> {x, y} | null
```

* **Vertical** movement needs a ladder segment whose centre is within
  `CLIMB_SNAP` (12 px) of `x` and whose span contains `y`; the mover snaps to the
  ladder centre and is clamped to the segment ends (which are always girder
  heights, so you always arrive standing on a floor).
* **Horizontal** movement needs `y` to be exactly a girder height, and a girder
  cell at the destination column. `x` is clamped to `[16, 656]` — the outermost
  ladder centres — so the mover can always reach every ladder.

Returning `null` for an illegal move gives the enemy AI a free legality probe: it
tries all four directions with a short distance and keeps the ones that succeed.

### Ingredients

An ingredient is four tiles wide (128 px) and tracks `level` — an index into
`PLATFORM_ROWS` — plus a four-slot `segments` array. Each frame the player is
standing on an ingredient's row and inside its span, the segment under their feet
is marked. When all four are marked the ingredient drops.

`dropIngredient(ing)`:

1. ignore it if already falling or already on a plate;
2. `level += 1`, clear `segments`, set `falling`, award `DROP_POINTS`;
3. if the new level is not the plate, recursively drop any ingredient resting
   there — that is the cascade, and because the recursion walks a contiguous run
   of occupied levels, the whole run shifts down exactly one floor;
4. animate `y` toward the new resting height at `FALL_SPEED`.

The plate level accepts any number of ingredients: they stack in landing order,
which is also bottom-up order because a shorter fall finishes first. Four
ingredients on a plate completes a burger; four burgers advances the level.

While an ingredient is falling, any enemy overlapping its band is squashed —
worth points, and it respawns at one of the fixed spawn points after a delay.

### Enemies

Enemies re-pick a direction every `AI_INTERVAL` (0.25 s): probe all four
directions, discard the illegal ones, and take whichever most reduces the
Manhattan distance to the player, preferring not to reverse unless that is the
only legal move. Contact with a non-stunned, non-squashed enemy costs a life and
resets everyone to their starting positions with a short grace period.

### Pepper

`sprayPepper()` spends one pepper and puts a short-lived cloud in front of the
chef. Enemies caught in it are stunned for `STUN_TIME`: they stop moving and
cannot hurt the player. Peppers refill to five at the start of each level.

## Controls

| input | action |
|---|---|
| arrow keys / `WASD` | walk and climb |
| `Space` | spray pepper (also starts the game from the title/game-over screen) |
| `Enter` | start the game |
| `P` | pause / resume |

## Testing

The game is a single classic (non-module) script so state and helpers are plain
globals reachable from Playwright, matching Snake, Kaboom and Tetris in this
repo. All simulation goes through `step(dt)`, which advances in fixed 1/240 s
sub-steps, so tests drive frames deterministically without touching
`requestAnimationFrame`. `startGame()`, `setPlayerPos()`, `setDirection()`,
`spawnEnemy()`, `dropIngredient()` and `platformY()` are exposed for tests.

## Assumptions

Made autonomously, choosing the simpler reading where the task was ambiguous:

* **Branch name.** The task asked for a branch named after the game, but this
  session is pinned to the assigned branch `claude/loving-euler-0n3j7g`, which
  wins; no `burger-time` branch is created.
* **One layout for every level.** Later levels reuse the same map and get harder
  through enemy count (`2 + level - 1`, capped at 5) and enemy speed rather than
  new geometry.
* **Four ingredients per burger** (top bun, lettuce, patty, bottom bun) rather
  than the arcade's variable five/six, because the map has exactly four girder
  rows above the plates.
* **Only the player treads ingredients.** In the arcade, enemies crossing an
  ingredient also nudge it; here they do not, which keeps the drop logic driven
  by a single actor and the tests deterministic.
* **No riders.** An enemy caught by a falling ingredient is squashed rather than
  riding it down, and does not add extra floors to the fall.
* **Pepper is a rectangle** in front of the chef rather than an animated puff,
  and stunned enemies are simply frozen and harmless — the player walks through
  them instead of over them.
* **Death does not pause the game.** Losing a life resets positions immediately
  with a short collision grace period instead of playing a death animation, so
  the state machine stays `idle / running / paused / over`.
* **Scoring** is flat and local: 50 per ingredient dropped, 100 per enemy
  squashed, 500 per burger completed, 1000 per level cleared. The high score is
  kept in `localStorage` under `burgertime-best`.
