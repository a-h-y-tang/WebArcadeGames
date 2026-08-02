# BurgerTime — Design

## Concept

BurgerTime is a ladders-and-platforms arcade game inspired by the 1982 Data East
coin-op. A chef runs along five floors joined by ladders. Walking the full width
of a burger ingredient knocks it down a level — and a pile that lands on another
pile shoves *that* one down too, so a single well-timed run can cascade an entire
burger toward the plate waiting at the bottom of the screen.

Hot dogs, eggs and pickles roam the maze hunting the chef. Touching one costs a
life, but the chef carries a limited supply of pepper that freezes them in place
for a few seconds — and an enemy standing on an ingredient when it drops rides it
all the way down and gets squashed for a fat bonus.

Assemble all four burgers onto their plates to clear the level.

## Mechanics

### The board

A 600×600 canvas holds:

- **Five floors** at `LEVEL_Y[0..4]`, spanning the full width. Level `5` is not a
  floor — it is the row of **plates** the finished burgers land on.
- **Five ladder columns** at x = 20, 160, 300, 440, 580. A ladder is stored as a
  set of one-floor *gaps* (`gap g` joins floor `g` to floor `g + 1`), and the
  middle ladders deliberately leave gaps out. That missing-rung layout is what
  turns the board into a maze instead of a grid — the outer two ladders are the
  only full-height routes.
- **Four burger columns** centred at x = 90, 230, 370, 510. Each ingredient is
  `ING_W` (112 px) wide and divided into `SEG_COUNT` (4) segments of 28 px.

Each column starts with its four ingredients spread down the board:

| Ingredient   | Starting floor |
|--------------|----------------|
| bun-top      | 0              |
| lettuce      | 1              |
| patty        | 2              |
| bun-bottom   | 3              |

Stacked bottom-to-top that ordering assembles into a real burger:
`bun-bottom → patty → lettuce → bun-top`.

### Pressing and dropping

Ingredients live in `piles[col][level]`, an array ordered **bottom-to-top**. Each
frame `updatePress()` checks whether the chef is standing on a floor inside a
burger column; if so it marks the segment under the chef's feet as pressed on the
**topmost** ingredient of that pile. Buried ingredients cannot be pressed — you
always walk on whatever is on top.

When all four segments of that top ingredient are pressed, `dropPile()` sends the
**whole pile** into the air as one falling group and clears the pressed segments.

### Cascading

`updateFalling()` moves each group down at `FALL_SPEED` toward `target`, the next
level below. On arrival:

- If a pile is already resting there, that pile is spliced in **underneath** the
  falling group and the whole combined stack keeps going one more level. This is
  the cascade: dropping the bun-top of a fresh column shoves the lettuce, then
  the patty, then the bun-bottom, and all four come to rest together on floor 4.
- Otherwise (empty level, or the plate) the group lands. It is concatenated onto
  whatever is already on that level, `restack()` recomputes every ingredient's
  level / stack index / draw height, and the group scores
  `POINTS_PER_INGREDIENT × group size`.

So a standard column takes **two runs**: one from floor 0 to cascade everything
onto floor 4, then one more across the top of that stack to send all four onto
the plate. A column is complete when `piles[col][PLATE_LEVEL].length === 4`.

### Movement

The chef and the enemies share the same movement model:

- Horizontal movement is only possible while standing on a floor.
- To climb, an actor must be within a snap distance of a ladder (`CHEF_SNAP` =
  14 px, `ENEMY_SNAP` = 6 px) **and** that ladder must have a rung joining the
  current floor to the one in the requested direction. Mounting snaps x to the
  ladder centre, so every arrival lands exactly on a floor's y — no floating
  point drift and no "almost on a floor" states.
- Ladders are stored one gap at a time. A tall ladder is several stacked gaps;
  the climber leaves the ladder at each floor and re-mounts the next gap on the
  following frame if the direction key is still held. That costs at most one
  frame per floor and keeps every floor a clean stepping-off point.

### Enemies

`enemyStep()` is deliberately simple, greedy pathing:

1. Stunned? Tick the timer down and do nothing else.
2. On a ladder? Keep climbing until the next floor.
3. On a different floor from the chef? Take a ladder here if one heads the right
   way, otherwise walk toward the **nearest** ladder that does.
4. Same floor as the chef? Walk straight at them.

Enemies spawn at the top floor from either outer ladder every `SPAWN_INTERVAL`
seconds up to a cap of `min(5, 3 + floor((level - 1) / 2))`. Their speed is
`min(110, 52 + 9 × (level - 1))`.

Spawn choices come from a small seeded LCG (`rnd()` / `setSeed()`) so a run can be
reproduced exactly in tests.

### Pepper and squashing

- `firePepper()` spends one shaker and sprays a `PEPPER_RANGE`-wide box in the
  direction the chef is facing. Enemies inside it are stunned for `STUN_TIME`
  seconds. A stunned enemy neither moves nor hurts the chef.
- When a pile drops, every live enemy standing on that stretch of that floor is
  captured as a **rider**. Riders die when the pile lands, worth
  `POINTS_PER_SQUASH` (500) each.

### Scoring, lives and levels

| Event                   | Points |
|-------------------------|--------|
| Each ingredient landed  | 50     |
| Enemy squashed          | 500    |
| Level cleared           | 1000   |

The chef starts with 3 lives and 5 peppers. Losing a life clears the board of
enemies and returns the chef to the start position — **ingredient progress is
kept**, so a death is a setback rather than a restart. Losing the last life ends
the game and writes the best score to `localStorage` under `burgertime-best`.

Clearing all four burgers awards the bonus, refills the peppers, rebuilds the
board and increments `level`, which makes enemies faster and raises their cap.

## Controls

| Key | Action |
|---|---|
| ← / → or A / D | Walk along a floor |
| ↑ / ↓ or W / S | Climb a ladder |
| Space | Start the game / throw pepper |
| Enter | Start the game |
| P | Pause / resume |

## Code layout

| File | Purpose |
|---|---|
| `index.html` | HUD, canvas, overlay, help strip |
| `style.css` | Panel/HUD/overlay styling, shared look with the other games |
| `game.js` | All state and logic, as plain script-scope globals |
| `tests/burgertime.spec.js` | Playwright suite (53 tests) |

`game.js` is a classic (non-module) script on purpose: the tests reach `state`,
`chef`, `piles`, `enemies`, `step(dt)`, `placeChef()`, `spawnEnemy()` and friends
as plain globals, which matches how Kaboom, Snake and Tetris are tested in this
repo. All motion is per-second and advanced through a single `step(dt)`, so tests
simulate frames deterministically instead of waiting on `requestAnimationFrame`.

## Assumptions

These are the calls made where the brief or the original arcade game left room
for interpretation. In each case the simpler reading was taken.

- **Branch naming.** The task asked for a branch named after the game
  (`burger-time`), but this session is pinned to the designated development
  branch `claude/loving-euler-9hcwsi` and must not push elsewhere. The work is
  therefore committed to the designated branch; the game name lives in the folder
  and commit message instead.
- **Piles fall whole.** In the original, ingredients interact individually. Here
  pressing the top ingredient drops the entire pile beneath it as one group.
  It keeps the falling model to a single object and makes the cascade — the most
  satisfying part of the game — reachable without frame-perfect play.
- **The chef walks at floor height.** Even when a pile several ingredients tall
  is resting on a floor, the chef's feet stay on the floor line rather than
  climbing the stack. Presses still apply to the topmost ingredient.
- **Riders are captured at drop time only.** An enemy that wanders under a pile
  already in mid-air is not squashed; only those standing on it when it lets go.
- **Fixed level layout.** Every level uses the same floor/ladder/ingredient
  layout. Difficulty scales through enemy speed and enemy count rather than new
  maps, which keeps level progression testable and the level data in one place.
- **No bonus items.** The original scatters coffee/ice-cream pickups that award
  an extra pepper. They are omitted; peppers refill on each new level instead.
- **Stunned enemies are harmless**, and the chef may walk straight through them.
