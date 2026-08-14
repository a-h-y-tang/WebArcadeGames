# Lode Runner — Design

## Concept

A tile-based dig-and-collect arcade platformer. The runner must sweep every
gold bar out of an underground vault while guards hunt them down. The runner
cannot jump and cannot fight — the only weapon is a shovel that carves a
temporary hole in a brick floor. Guards that stumble into a hole are stuck
long enough to run over their heads, and a hole that heals with a guard inside
buries them for good. Collect all the gold and a hidden escape ladder appears;
climb it to the top of the screen to clear the level.

## Files

| File | Role |
|---|---|
| `index.html` | Canvas, HUD, overlay and key legend |
| `style.css` | Dark vault theme shared in spirit with the rest of the repo |
| `game.js` | Whole game: level data, simulation, rendering, input |
| `tests/loderunner.spec.js` | Playwright suite driving the exposed globals |

`game.js` is a classic script (no modules) so every top-level binding is
reachable from `page.evaluate` — the same testing approach the other games in
this repo use.

## Board model

The world is a fixed grid: `COLS = 28` by `ROWS = 16` at `TILE = 20` pixels,
giving a 560x320 canvas. Levels are authored as ASCII art, one string per row:

| Char | Meaning |
|---|---|
| `#` | Solid stone — blocks movement, cannot be dug |
| `B` | Brick — blocks movement, **can** be dug |
| `H` | Ladder |
| `-` | Hand-over-hand bar |
| `$` | Gold |
| `&` | Guard spawn |
| `@` | Runner spawn |
| `S` | Escape ladder — inert until every gold is collected |
| (space) | Empty air |

`loadLevel()` parses the art into `grid` (terrain only) plus separate `gold`,
`guards` and `runner` records, so entities and terrain never fight over a cell.

Levels are laid out on a repeating rhythm: walkable rows at 2, 5, 8, 11 and 14,
with platforms directly beneath them at 3, 6, 9, 12 and solid bedrock at 15.
Ladders therefore span exactly three rows to join two walkable rows.

## Movement

Positions are floats in *tile* units, so `runner.x = 4.5` is halfway between
columns 4 and 5. The occupied cell is `Math.round` of each coordinate.

An entity is **supported** at an aligned position when any of these hold:

- the tile below blocks (standing on a floor)
- its own tile is a ladder (standing on a rung)
- the tile below is a ladder (standing on a ladder's top)
- its own tile is a bar (hanging)

Anything not supported falls at `FALL_SPEED`, snapped to its column, until it
reaches a row where it rests again. Falls pass straight through bars — only
floors and ladders stop a fall, which is what makes dropping through a bar a
deliberate move rather than an accident.

Horizontal movement only happens from a row-aligned, supported position and is
refused when the destination tile blocks. Vertical movement only happens from a
column-aligned position: up requires a ladder in the current cell, down
requires the cell below to be passable (a ladder is climbed at
`CLIMB_SPEED`, anything else becomes a fall). Running off the edge of a
platform is legal and turns into a fall as soon as the runner's centre passes
into the empty column.

## Digging

`dig(dirX)` carves the brick diagonally below-left or below-right. It is
refused unless all of these hold:

- the runner is aligned, not falling, and standing on a blocking tile
- the runner is not on a ladder or a bar
- the target tile is `B` (brick — never stone)
- the tile directly above the target is passable, so there is somewhere for
  the debris to have come from and somewhere for a body to fall in

A dug tile becomes empty and is recorded in `holes` with a timer. After
`HOLE_REFILL` seconds it turns back into brick; the last `HOLE_WARN` seconds
render as a flashing outline. Anything standing in a hole when it heals is
crushed: the runner loses a life, a guard is buried and scores points.

A hole treats the two kinds of entity differently, which is what makes it a
weapon rather than a trapdoor. The runner drops straight through — digging down
is how you descend in a hurry — while a guard that falls in *rests* there and is
stuck. `restsAt()` takes an `isGuard` flag for exactly this reason, and while a
guard is trapped its cell counts as support for whoever is standing above it.

## Guards

Guards use breadth-first search over the same movement graph the runner obeys
(walk when supported, climb ladders, drop into anything passable) and step
toward the first node of the path to the runner. The path is recomputed
whenever a guard becomes tile-aligned, which is cheap on a 448-cell board and
keeps them relentless without being psychic — they can only reach the runner
by a route the runner could also walk.

A guard that falls into a hole is `trapped` for `GUARD_TRAP` seconds, then
climbs out sideways to a cell it can stand on. While trapped it cannot hurt
the runner, so its head is a safe stepping stone. A buried guard respawns near
the top of the board after a short delay, so the level never runs out of
threat.

Guard speed rises with the level number but is permanently capped below the
runner's speed — a guard should be able to corner the runner, never simply
outrun them in a straight line.

## Scoring

| Event | Points |
|---|---|
| Gold collected | 150 |
| Guard buried | 250 |
| Level cleared | 1000 |

The best score is persisted to `localStorage` under `loderunner-best`.

## Controls

| Key | Action |
|---|---|
| `←` `→` / `A` `D` | Run, climb along bars |
| `↑` `↓` / `W` `S` | Climb ladders, drop off bars |
| `Z` or `,` | Dig down-left |
| `X` or `.` | Dig down-right |
| `Space` / `Enter` | Start or restart |
| `P` | Pause |

## Game flow

`state` moves through `idle → running → (paused) → dying / levelclear → over`.
`step(dt)` is a pure fixed-step simulation tick and `draw()` is a pure render,
which is what lets the tests advance hundreds of deterministic frames without
touching `requestAnimationFrame`.

## Assumptions

These were resolved without asking, choosing the simpler reading each time:

- **Branch name.** The task asks for a branch named after the game
  (`lode-runner`), but this session is required to develop and push on the
  designated branch `claude/loving-euler-3eudtx`. The designated branch wins;
  no second branch is created.
- **Guards do not carry gold.** In the arcade original a guard can pick up a
  gold bar and drop it later. That creates a genuine soft-lock risk (gold
  dropped into a hole that then heals over it), so guards here ignore gold
  entirely.
- **No standing on guards' heads.** The original lets the runner stand on a
  free guard; here only a *trapped* guard is a platform, because its cell is
  simply passable air.
- **Death restarts the level.** Losing a life restores the level completely,
  gold included, rather than resuming mid-sweep. The score is kept.
- **Three hand-authored levels** cycle forever, with guard *speed* rising by
  level number, instead of shipping the original's 150 levels. Guard count is
  whatever the map author placed and does not scale.
- **Holes catch guards, not the runner.** The original is ambiguous about
  whether a pit holds you; here the runner falls through and guards are caught,
  which keeps both the dig-to-descend technique and the trap-a-guard mechanic
  without ever letting a player dig themselves into an unwinnable pit.
- **Escape means the top row.** Reaching row 0 by any means clears the level
  once the exit ladder is open; the game does not require the runner to be on
  the ladder itself at that moment.
- **The runner does not die from a fall**, however far it is — falls are only
  dangerous because of where they land you.
- **Level maps are validated, not solved.** A test asserts every gold and the
  top row are reachable from the spawn through the movement graph *without
  digging*, which is a stronger guarantee than the original levels give and is
  cheap to check. It is not a proof that a level can be finished while guards
  are chasing.
- **Game browser count.** `game-browser/e2e/game-browser.spec.ts` hard-codes a
  game count that was already stale before this change (105 asserted vs 108
  entries). That suite needs a running dev server and is outside this game's
  scope, so it is left untouched.
