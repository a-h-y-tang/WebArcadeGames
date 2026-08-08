# Burger Time — Design

## Concept

Burger Time is a single-screen arcade platformer inspired by Data East's 1982
classic *BurgerTime*. You play **Chef Pierre**, running along a scaffold of
girders and ladders that holds four half-built hamburgers. Walking the full
width of an ingredient — bun, lettuce, patty, heel — knocks it down one floor.
Knock every ingredient all the way to the plates at the bottom and the burgers
are served, clearing the level.

You are not alone up there. Escaped food — a hot dog, a fried egg and a pickle —
hunts you across the girders. One touch costs a life. Your only weapon is a
shaker of **pepper**: a puff of it freezes anything caught in the cloud for a
few seconds so you can slip past. Peppers are scarce, so the real weapon is the
scaffold itself — time a falling ingredient so it lands on an enemy and the
enemy is flattened with it, worth double for each one caught in the same drop.

## Board geometry

The board is a 600×480 canvas divided into a 15-column grid of 40px tiles.

- **Five girders (floors)** run the full width of the board at
  `LEVEL_Y = [80, 160, 240, 320, 400]`. Levels are referred to by index 0
  (top) through 4 (bottom).
- **Level 4 is the plate level.** The four plates sit on the bottom girder;
  an ingredient that reaches it is *plated* and inert.
- **Four burger stacks**, each 3 tiles (120px) wide, occupy columns
  `0–2`, `4–6`, `8–10` and `12–14`.
- **Three ladders** fill the gap columns `3`, `7` and `11` and run unbroken
  from the top girder to the bottom one. Every girder spans the whole board, so
  each floor is fully connected and any of the three ladders reaches any level.
- Each stack starts with four ingredients — bun top (level 0), lettuce
  (level 1), patty (level 2) and bun heel (level 3) — so 16 ingredients in all.

## Mechanics

### Walking ingredients down

Each ingredient is divided into the same three tiles it spans. Whenever the chef
is standing on a girder, the tile directly under him is marked *stepped* (and is
drawn pressed down). When all three tiles of an ingredient have been stepped,
the ingredient drops.

A dropping ingredient falls at a constant speed to the girder **one level
below**:

- If another ingredient is resting there, that one is knocked loose and begins
  its own one-level fall, while the faller comes to rest in the space it
  vacated. Knocks chain, so a well-timed drop from the top can send the whole
  stack cascading a floor at a time.
- If the level below is the plate level, the ingredient is *plated*: it settles
  onto the plate, stacking on top of anything already served there, and can
  never be moved again.

A dropped ingredient's stepped tiles reset, so an ingredient sitting on an
intermediate girder must be walked across again to move it further down.

### Enemies

Enemies patrol the same girders and ladders. Their AI is deterministic (no
randomness, which keeps the simulation reproducible in tests): on reaching a
girder an enemy walks toward the chef if they share a level, and otherwise heads
for the nearest ladder and climbs toward the chef's level.

- Touching an un-stunned enemy costs a life and resets the chef and all enemies
  to their spawn points. Ingredient progress is kept.
- A falling ingredient that overlaps an enemy squashes it. The enemy respawns
  after a delay. Squashes are scored `100 × 2^n` for the *n*th enemy caught in
  the same fall, so catching three at once is worth 700.

### Pepper

Pressing <kbd>Space</kbd> throws a puff of pepper into the tile in front of the
chef. Every enemy inside the cloud is stunned for `STUN_TIME` seconds — stunned
enemies stop moving and are harmless to touch. You start each *game* with five
peppers and they are not replenished between levels.

### Levels, lives and scoring

- Clearing all 16 ingredients advances the level: the board is rebuilt, enemies
  get faster and one more enemy joins (up to the four spawn points).
- You start with three lives. Losing the last one ends the game.
- Scoring: **50** per ingredient dropped (including chain knocks), **100 ×
  2^n** per enemy squashed in a single fall, and **1000** for clearing a level.
- The best score is persisted in `localStorage` under `burgertime-best`.

## Controls

| Input | Action |
|---|---|
| ← / → / A / D | Walk left / right along a girder |
| ↑ / ↓ / W / S | Climb a ladder (only when lined up with one) |
| Space | Throw pepper |
| Enter | Start / restart |
| P | Pause / resume |

## Code structure

Everything lives in three files with no build step:

- `index.html` — HUD, canvas and the start/game-over overlay.
- `style.css` — layout and the diner-sign styling.
- `game.js` — a single classic (non-module) script so that state and helpers are
  reachable from Playwright as plain globals, matching Kaboom, Snake and Tetris
  in this repo.

The simulation is driven entirely by `step(dt)`, which `requestAnimationFrame`
calls with the real frame delta but which tests call directly with a fixed
`0.016`. Nothing in the model reads the wall clock or `Math.random()`, so a test
can place the chef, run a known number of frames, and assert on the exact
resulting state.

Key globals used by the tests:

| Name | Meaning |
|---|---|
| `state` | `'idle' \| 'running' \| 'paused' \| 'over'` |
| `score`, `best`, `lives`, `peppers`, `level` | HUD values |
| `chef`, `enemies`, `ingredients` | live simulation objects |
| `step(dt)` | advance the simulation one frame |
| `startGame()`, `endGame()`, `togglePause()` | lifecycle |
| `placeChef(level, x)` | teleport the chef to a girder (test helper) |
| `moveChef(dx, dy)` | set the chef's input direction |
| `sprayPepper()` | throw pepper |
| `dropIngredient(ing)` | knock an ingredient loose |
| `ingredientAt(stack, level)` | the resting ingredient at a board cell |
| `LEVEL_Y`, `TILE_W`, `LADDER_COLS`, `PLATE_LEVEL`, … | geometry constants |

## Assumptions

The task description left a few things open. Where it did, the simpler reading
was taken:

1. **Branch name.** The instructions asked for a branch named after the game in
   kebab-case (`burger-time`), but this session is also pinned to the
   pre-assigned branch `claude/loving-euler-91abkp` and told never to push
   anywhere else. The pinned branch won: all work is committed there, and the
   game name shows up in the folder, commits and PR title instead.
2. **Scope of the arcade original.** The original has six levels with hand-drawn
   scaffolds. Here a single symmetrical scaffold is reused for every level, with
   difficulty coming from enemy count and speed. That keeps the level data to
   one small table rather than a level editor's worth of layouts.
3. **Enemies riding ingredients.** In the arcade, an enemy standing on an
   ingredient rides it down and is only squashed on landing, and enemies caught
   in a bun become bonus food. Here a falling ingredient squashes any enemy it
   overlaps immediately. The scoring (doubling per enemy in one fall) is kept.
4. **Pepper.** Pepper is applied the instant it is thrown to everything inside
   the cloud rather than lingering as a hitbox for enemies to walk into; the
   cloud that is drawn is purely a visual flourish.
5. **Randomness.** The arcade's enemies wander semi-randomly. This version's
   chase AI is fully deterministic so that the Playwright suite can assert exact
   positions without seeding a PRNG.
6. **Ingredient overlap while falling.** Two ingredients falling in the same
   stack at once may briefly overlap on screen. Correct stacking is guaranteed
   at the plate (fallers are resolved lowest-first each frame), and the overlap
   lasts a fraction of a second, so no separate spacing rule was added.
