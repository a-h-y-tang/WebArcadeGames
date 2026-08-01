# BurgerTime — Design

## Game concept

A platform-and-ladder arcade game. Chef Pepper is trapped on a scaffold of
girders and ladders with four half-built burgers hanging above four plates.
Walking the full width of an ingredient knocks it down one level; ingredients
that land on other ingredients knock *those* loose too, so a well-planned run
cascades a whole burger at once. Hot dogs, eggs and pickles patrol the
scaffold; a limited pepper shaker is the only defence. Bury all four burgers on
their plates to serve the level.

## World model

Everything lives on a `TILE = 28` px grid, `COLS = 21` × `ROWS = 18`, giving a
588 × 504 canvas.

| Feature | Value |
|---|---|
| Walkable girders (`FLOOR_ROWS`) | rows 2, 5, 8, 11, 14 |
| Plate shelf (`PLATE_ROW`) | row 17 |
| Ladder columns (`LADDER_COLS`) | 0, 5, 10, 15, 20 |
| Burger columns (`BURGER_COLS`) | 1, 6, 11, 16 (four tiles wide each) |

The burger columns and the ladder columns interleave exactly, so no ladder ever
runs through an ingredient. Every ladder spans the full height of the tower,
from the top girder to the bottom one — the scaffold is fully connected.

Each burger holds four ingredients (top bun, lettuce, patty, bottom bun) which
start resting on the top four girders, one per girder. Ingredients are drawn
`PIECE_H = 8` px thick, sitting on top of the girder line, and each is split
into four one-tile **segments**.

## Mechanics

### Movement

The chef moves continuously in pixels, constrained to two rails:

- **Horizontal** movement is allowed only while `y` is on a girder line.
- **Vertical** movement is allowed only while `x` is on a ladder centre line.

Rather than requiring pixel-perfect alignment, a move request *snaps* onto the
nearest rail if it is within `SNAP = 0.8 × TILE`. Holding Right partway up a
ladder therefore drops the chef back onto the girder just below and walks off
it, which is how the arcade original feels without needing a queued-input
system.

`tryMoveChef()` reports whether a direction actually got anywhere. When it does
not — Down pressed halfway between two ladders, say — `moveChef()` falls back to
the direction the chef was already travelling, so the chef keeps walking until
the requested rail comes into range rather than stalling on the spot. Holding
Down while running along a girder therefore drops the chef down the next ladder
it reaches.

### Knocking ingredients down

Each frame, `updatePress()` finds the girder the chef is standing on and the
tile column it occupies. Any ingredient resting on that girder whose span
covers that tile gets the matching segment marked pressed (and drawn sagging).
When all four segments of an ingredient are pressed, `dropPiece()` fires it.

### Falling — the cascade rule

`updatePieces()` runs per burger, walking that burger's column of ingredients
**bottom-most first** so a falling piece always sees the settled position of
whatever it is landing on. Each falling ingredient is limited by the lower of:

- `floorLimit` — the next girder below its starting row (or the plate), and
- `belowLimit` — the top of the next ingredient down in the same burger.

Three outcomes when a falling ingredient reaches its limit:

1. **It reached a girder with nothing under it** — it stops there.
2. **It landed on a resting ingredient** — that ingredient is knocked down in
   turn, and the falling one is flagged `carried`, riding on top of it.
3. **It landed on an ingredient that has already reached a plate** — it joins
   that plate's stack.

A `carried` ingredient ignores its own girder target and simply tracks the
piece underneath, settling on top of it when that piece finally stops. This
reproduces the arcade behaviour: a cascade travels *one level* and comes to
rest as a stack, and the player must walk the stack again to push it further.
With the starting layout (ingredients on four consecutive girders), one clean
run collapses a burger onto the bottom girder, and a second run buries it.

Nothing can ever fall past the plate, and stacks pile upward from the plate in
landing order.

### Enemies

Enemies travel the coarse graph of ladder × girder intersections. On reaching a
node they pick a neighbour: 75 % of the time the one that most reduces the
Manhattan distance to the chef, 25 % of the time at random, never immediately
reversing unless it is the only option. Because they only ever move along a
girder line or a ladder centre line, they stay on the rails by construction.

- Touching the chef costs a life (`DYING_TIME` pause, then everyone respawns).
- An enemy standing on an ingredient when it drops is caught as a **rider**: it
  is carried down and squashed when the ingredient settles, worth 100 points,
  doubling for each extra enemy squashed by the same drop.
- A squashed enemy returns after `RESPAWN_TIME = 5 s` at its spawn node.

### Pepper

`Space` throws pepper into a rectangle in front of the chef (`1.9 × TILE`
reach, `0.7 × TILE` to each side). Enemies caught in it sneeze for
`PEPPER_STUN = 3.5 s`, during which they neither move nor hurt the chef. The
shaker holds five shakes and refills each level.

### Scoring and progression

| Event | Points |
|---|---|
| Ingredient knocked down | 50 |
| Enemy squashed | 100, doubling per extra enemy in the same drop |
| Level cleared | 500 |

Each level adds one enemy (capped at 5) and 5 px/s of enemy speed (capped at
78 px/s). The best score persists in `localStorage` under `burgertime-best`.

## Controls

| Input | Action |
|---|---|
| `←` `→` / `A` `D` | Walk along a girder |
| `↑` `↓` / `W` `S` | Climb a ladder |
| `Space` | Throw pepper (also starts a new game from the title/game-over screen) |
| `P` | Pause / resume |

## Code layout

Single classic (non-module) script, matching Kaboom, Dino Run, Snake and Tetris
in this repo, so state and logic are reachable from Playwright as plain globals.

| File | Contents |
|---|---|
| `index.html` | HUD, canvas, overlay, on-screen help |
| `style.css` | Layout and the diner-sign look |
| `game.js` | Constants, level construction, simulation, rendering, input |
| `tests/burgertime.spec.js` | 66 Playwright specs |

`game.js` sections, in order: geometry helpers → level construction → game flow
→ chef → ingredients → enemies → pepper → `step(dt)` → rendering → HUD → input
→ main loop.

All motion is expressed per second and advanced through `step(dt)`. Setting
`AUTO_STEP = false` detaches the `requestAnimationFrame` driver, which is how
the test suite simulates frames deterministically without racing the browser's
frame clock. `draw()` still runs, so rendering can be asserted independently.

## Assumptions

These were the ambiguous calls; each was resolved toward the simpler reading.

- **Branch name.** The task asked for a branch named after the game
  (`burger-time`), but this session is pinned to the designated development
  branch `claude/loving-euler-5wc6lu` and is not permitted to push elsewhere.
  The work is on the designated branch; the game folder carries the name.
- **Fixed level layout.** Every level uses the same scaffold and the same four
  burgers. Difficulty scales through enemy count and speed rather than through
  new level geometry, which keeps level generation out of scope.
- **Ladders span the whole tower.** The arcade original has partial ladders as
  level design. Full-height ladders keep the graph trivially connected, keep
  enemy pathing simple, and keep every ingredient reachable.
- **Four ingredients per burger, always.** No extra ingredients (cheese, tomato)
  on later levels.
- **Walking a settled stack presses every ingredient in it.** Only the top one
  is visible, and pushing the top of a stack pushes the whole stack anyway, so
  the outcome matches the arcade even though the bookkeeping is simpler.
- **No extra fall level per rider.** In the arcade, each enemy riding an
  ingredient drives it one floor further. Here riders are carried and squashed
  but do not change how far the ingredient travels.
- **Enemies pass through ingredients.** They are not blocked by stacks; only
  girders and ladders constrain them.
- **Physics keeps running during the death pause** so an in-flight cascade
  finishes naturally instead of freezing mid-air.
- **`localStorage` failures are ignored** (a `file://` page with storage
  disabled still plays; only the best score is lost).
