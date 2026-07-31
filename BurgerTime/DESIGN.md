# BurgerTime — Design

## Concept

A burger-building platform arcade game in the spirit of the 1982 coin-op. Chef
Pierre runs along five girders connected by ladders inside a giant kitchen.
Four burgers hang in mid-air, each split into four layers (top bun, lettuce,
patty, bottom bun) resting on separate girders. Walking the full width of a
layer tips it off its girder; it falls to the girder below, knocking anything
resting there loose as well, until every layer lands on the plate at the
bottom. Assemble all four burgers to clear the level.

Hot dogs, fried eggs and pickles hunt the chef the whole time. He carries a
limited supply of pepper to stun them, and a falling ingredient flattens any
enemy caught underneath it.

## Mechanics

### Board

| Element | Value |
|---|---|
| Canvas | 600 × 480 |
| Girders (`FLOOR_YS`) | y = 60, 150, 240, 330, 420 |
| Ladders (`LADDER_XS`) | x = 30, 170, 310, 450, 580 — every ladder spans every girder |
| Burger stacks (`STACK_XS`) | x = 60, 200, 340, 480, each 80 px wide |
| Layers per burger | 4 — one per girder, floors 0–3 |
| Plates | on the bottom girder (y = 420), one under each stack |

### Ingredients

* Each ingredient is four 20 px segments. Standing on a segment presses it
  down; when all four have been trodden the ingredient tips off the girder.
* A falling ingredient drops to the next girder down and stops there — unless
  another ingredient is already resting on that girder, in which case that one
  is knocked loose too and both keep falling. This is the chain reaction that
  makes dropping a top bun cascade the whole burger.
* An ingredient falling past the lowest ingredient girder lands on the plate.
  Plated layers stack 8 px apart in landing order, so the bottom bun (which
  falls first, being lowest) ends up under the patty, and so on.

### Enemies

* Enemies chase the chef greedily and deterministically: on the chef's girder
  they walk straight at him; otherwise they head for the nearest ladder and
  climb toward his girder.
* Touching an unstunned enemy costs a life; the chef and all enemies return to
  their start positions and a one-second grace period follows.
* An enemy caught under a falling ingredient is squashed and respawns three
  seconds later at one of the four spawn corners.
* Enemy speed is `46 + 7 × (level − 1)` px/s and the enemy count is
  `min(4, 1 + level)`.

### Pepper

* `Space` throws a pepper cloud into the tile in front of the chef. Enemies
  caught in it are stunned for 4 seconds — frozen and harmless.
* The chef starts with 5 shakers and earns one per level cleared (max 9).

### Scoring

| Event | Points |
|---|---|
| Tipping an ingredient off a girder (including chained pushes) | 50 |
| An ingredient reaching the plate | 100 |
| Squashing an enemy | 100, doubling for each extra enemy in the same fall (100 / 200 / 400 …) |
| Clearing a level | 500 |

Best score is kept in `localStorage` under `burgertime-best`.

## Controls

| Key | Action |
|---|---|
| `←` `→` / `A` `D` | Walk along a girder |
| `↑` `↓` / `W` `S` | Climb a ladder (the chef snaps to a ladder within 12 px) |
| `Space` | Throw pepper (also starts / restarts the game) |
| `P` | Pause / resume |

## Code structure

* `index.html` — HUD (score, lives, level, pepper, best), canvas and overlay.
* `style.css` — dark kitchen-arcade styling shared in spirit with the other games.
* `game.js` — a single classic (non-module) script so state and helpers are
  reachable from Playwright as plain globals, matching Kaboom/Snake/Tetris.
  All motion is per-second and advanced by `step(dt)`; `requestAnimationFrame`
  only supplies `dt` and calls `draw()`, so the tests simulate frames
  deterministically without depending on wall-clock timing.

Key globals used by the tests: `state`, `score`, `lives`, `level`, `player`,
`ingredients`, `enemies`, `peppers`, and the functions `startGame`,
`startLevel`, `step`, `movePlayer`, `setPlayerPos`, `dropIngredient`,
`spawnEnemy`, `throwPepper`, `loseLife`, `endGame`, `togglePause`,
`enemySpeed`, `updateHud`.

State machine: `idle → running ⇄ paused`, `running → levelclear → running`
(next level after 2.5 s), `running → over`.

## Testing

`tests/burgertime.spec.js` holds 62 Playwright tests written before the
implementation, covering the idle board, start-up, walking/climbing limits,
segment treading, chain drops, plate stacking, enemy chase/collision/squash
scoring, pepper stunning, level clearing and progression, pausing, lives, game
over and best-score persistence.

```powershell
npx playwright test BurgerTime/tests/
```

## Assumptions

These were decided while building autonomously; the simpler reading was taken
each time.

* **Branch name.** The task asked for a branch named after the game, but this
  session is pinned to the designated branch `claude/loving-euler-2bjuaj`, so
  the work was developed and pushed there instead.
* **One level layout.** Every level uses the same girder/ladder/burger layout;
  difficulty comes from enemy speed and count rather than new boards. This
  keeps the level data trivial and the tests stable.
* **Ladders are full height.** Rather than modelling per-segment ladders, all
  five ladders connect all five girders, so enemy pathing never needs a search.
* **Walking line.** The chef's feet stay on the girder line even when crossing
  an ingredient; only the drawing is lifted by the ingredient's 8 px so it
  reads correctly. Collision and treading use the girder line.
* **No crushing the chef.** A falling ingredient squashes enemies only; the
  chef is never hurt by one, and he cannot ride an ingredient down.
* **Deterministic enemies.** Enemy AI is purely greedy with no randomness, so
  the behaviour is reproducible in tests and predictable for the player.
* **Pepper is a fixed cloud.** The cloud appears in a fixed rectangle in front
  of the chef and fades after 0.45 s rather than travelling as a projectile.
* **Score display.** Points are shown in the DOM HUD only; there are no
  floating score popups on the canvas.
