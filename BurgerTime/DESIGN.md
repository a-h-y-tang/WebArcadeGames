# Burger Time — Design

A single-screen platform arcade game on an HTML5 canvas. The player is a chef who
builds four hamburgers by walking across their ingredients so they fall, girder by
girder, onto the plates at the bottom of the screen — while food enemies chase him
around the ladders.

## Game concept

Four burger stacks hang across five horizontal girders. Each stack is made of four
ingredients (top bun, lettuce, patty, bottom bun), one per girder. Walking the full
width of an ingredient makes it drop to the girder below; anything it lands on gets
knocked loose too, so a well-timed run sends a cascade rippling down a column.
Plate all sixteen ingredients to clear the level.

Three food enemies (hot dog, fried egg, pickle) hunt the chef. Touching one costs a
life. The chef fights back two ways: shaking pepper to freeze enemies for a few
seconds, and dropping an ingredient on top of one, which squashes it for bonus
points and sends it back to its spawn a few seconds later.

## World layout

```
 y=86   ═══════════════════════════════  floor 0   [top bun    ×4]
 y=164  ═══════════════════════════════  floor 1   [lettuce    ×4]
 y=242  ═══════════════════════════════  floor 2   [patty      ×4]
 y=320  ═══════════════════════════════  floor 3   [bottom bun ×4]
 y=398  ═══════════════════════════════  floor 4
 y=462   ▭      ▭      ▭      ▭          plates
```

- The canvas is 600 × 520. Girders span the full width, so the chef can always walk
  from edge to edge on any floor.
- The four ingredient columns start at x = 54, 186, 318, 450. Each ingredient is
  96 px wide and split into **four 24 px segments**.
- Ladders are 24 px wide and sit in the gaps *between* columns, never overlapping an
  ingredient. Every gap between adjacent floors is served by at least two ladders,
  so every floor is reachable from every other floor:

  | Floors | Ladder x positions |
  |---|---|
  | 0 ↔ 1 | 168, 432 |
  | 1 ↔ 2 | 28, 300, 572 |
  | 2 ↔ 3 | 168, 432 |
  | 3 ↔ 4 | 28, 300, 572 |

- Ingredients resting on a plate stack upward from y = 462 in 10 px layers, well
  clear of the bottom girder.

## Mechanics

### Walking an ingredient down

Each ingredient tracks a `segs` array of four booleans. While the chef stands on an
ingredient's floor, whichever segment his centre is over is marked as stepped (and
visibly sags). When all four segments are stepped the ingredient breaks loose:

- It descends at 180 px/s toward the next floor down.
- On reaching that floor, if another resting ingredient occupies the same column
  there, that one is knocked loose too — a **chain** — and the arriving piece
  bounces on past it toward the next girder down. Either of them may knock
  something else loose in turn, so one drop ripples through a stack.
- An ingredient that reaches a free girder settles there and its segments reset:
  it has to be walked all over again from its new floor. Walking the top girder
  end to end therefore cascades a whole column but only plates part of it — the
  rest is left scattered down the board.
- Past the bottom girder it lands on the column's plate, stacking on top of
  whatever is already there.

Scoring: 50 points each time an ingredient starts falling, so a chain pays 50 per
piece it knocks loose. Squashing enemies pays 100 for the first enemy in a drop,
doubling for each extra one.

### Enemies

Enemies use a deterministic greedy chase, re-evaluated every sub-step:

- If the chef is on the enemy's floor, walk toward him.
- Otherwise pick the ladder from this floor heading in the chef's vertical
  direction whose x is nearest, walk to it, and climb.

Contact with a live, unstunned enemy costs a life; the chef and all enemies reset to
their starting positions, the chef gets 1.5 s of invulnerability, and ingredient
progress is kept. A squashed enemy disappears and respawns at its spawn point after
3 seconds. Enemy speed rises 5 px/s per level from 48 and is capped at 78 — always
below the chef's 90, so the chef can outrun them.

### Pepper

Pressing Space throws a pepper cloud 26 px in the direction the chef faces. Any
enemy inside it is stunned for 3 seconds — frozen, harmless, and still squashable.
Pepper is limited (5 shakes, +2 each new level), so it is an escape tool rather than
a weapon.

### Level flow

- 3 lives. Losing the last one ends the game; the best score persists in
  `localStorage` under `burgertime-best`.
- Clearing all sixteen ingredients awards 1000 points, then restocks the same
  layout with one more enemy (capped at 5) and faster enemies.

## Controls

| Input | Action |
|---|---|
| <kbd>←</kbd> <kbd>→</kbd> / <kbd>A</kbd> <kbd>D</kbd> | Walk along a girder |
| <kbd>↑</kbd> <kbd>↓</kbd> / <kbd>W</kbd> <kbd>S</kbd> | Climb a ladder |
| <kbd>Space</kbd> | Throw pepper (also starts / restarts the game) |
| <kbd>P</kbd> | Pause / resume |
| Start button | Start, restart or resume |

## Code structure

`game.js` is a single classic (non-module) script, matching the other games in this
repo, so every piece of state and every function is reachable from the Playwright
tests as a plain global. All motion is expressed per second and advanced through
`step(dt)`, which runs the world in fixed 1/240 s sub-steps — fine enough that a
falling ingredient can never tunnel past an enemy or a girder. Nothing in the
simulation reads the wall clock or `Math.random`, so tests drive frames
deterministically without `requestAnimationFrame`.

Key globals used by the tests:

| Name | Meaning |
|---|---|
| `state` | `'idle'` \| `'running'` \| `'paused'` \| `'over'` |
| `score`, `best`, `level`, `lives`, `pepper` | HUD values |
| `chef` | `{ x, y, floorIndex, ladder, inputX, inputY, facing, invuln }` |
| `ingredients` | 16 × `{ col, type, floorIndex, x, y, segs, falling, plated }` |
| `enemies` | `{ type, x, y, floorIndex, ladder, alive, stun, respawn, spawnX }` |
| `peppers` | short-lived clouds `{ x, y, life }` |
| `CANVAS_W`, `CANVAS_H`, `FLOOR_Y`, `PLATE_Y`, `COL_X`, `SEG_W`, `ING_W`, `ING_H`, `LADDERS`, `LADDER_W`, `CHEF_SPEED` | geometry / tuning |
| `startGame()`, `step(dt)`, `togglePause()` | flow and simulation |
| `moveChef(dx, dy)`, `setChefPos(x, floorIndex)` | movement |
| `throwPepper()`, `startFall(ing)`, `spawnEnemy(x, floorIndex, type)` | actions |
| `ladderAt(x, floorIndex, dir)`, `platedCount(col)`, `allPlated()`, `enemySpeed()` | queries |

Rendering (`draw()`) is entirely separate from the simulation and reads state only,
so it can never affect gameplay or test outcomes. The only value it owns is
`animTime`, used for idle wobble and the pepper swirl.

## Assumptions

These were judgement calls made without asking, following "pick the simpler
interpretation":

1. **Branch name.** The task asked for a branch named after the game
   (`burger-time`), but this session is pinned to the designated development branch
   `claude/loving-euler-uz80b8` and pushing anywhere else is not permitted. The work
   therefore lives on the designated branch.
2. **A chain bumps one girder at a time**, as in the arcade original, rather than
   sweeping a whole column onto the plate. Ingredients never rest on top of one
   another mid-board: the arriving piece bounces past the one it knocked loose, so
   pieces leapfrog each other downward. An early version let chains ride straight
   to the plate, which meant a single pass along the top girder won the level.
3. **Burger order is not enforced.** Ingredients stack on a plate in arrival order,
   so a burger can end up with the lettuce under the patty. The original behaves the
   same way, and enforcing an order would add rules without adding play.
4. **Squashing an enemy does not add an extra drop level**, unlike the original.
   Chains already provide the deep drops.
5. **Enemies cannot ride a falling ingredient** — they are squashed immediately.
6. **Deterministic enemy AI.** The chase uses no randomness, so tests can assert
   exact behaviour. The cost is predictable enemies; multiple pursuers arriving from
   different spawns keep it interesting.
7. **A single level layout.** Clearing the burgers restocks the same girder layout
   with more and faster enemies rather than introducing new maps, keeping the level
   data to one table.
8. **Fixed-size canvas** (600 × 520, no responsive scaling), matching the other
   games in this repo.
9. **Segments are marked by the chef's centre point**, not by full-body overlap —
   simpler, and it matches how the sag animation reads on screen.
