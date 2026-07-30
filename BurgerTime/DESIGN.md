# Burger Time — Design

## Concept

A single-screen platform arcade game on an HTML5 canvas. You play a chef trapped
in a maze of floors and ladders above four empty plates. Every burger ingredient
sits somewhere on the girders; walking the full width of an ingredient makes it
fall one floor. Keep walking each ingredient down until it lands on its plate.
Assemble all four burgers to clear the level.

Roaming food enemies (hot dog, egg, pickle) hunt the chef along the same floors
and ladders. Touching one costs a life. The chef fights back two ways: a falling
ingredient squashes any enemy standing on it, and a limited stock of pepper
shakers stuns nearby enemies for a few seconds.

## Layout

The play field is a fixed 640x560 canvas:

- **6 floors** (walkable girders) at `y = 70, 150, 230, 310, 390, 470`.
- **4 burger columns** centred at `x = 100, 240, 380, 520`.
- **4 plates** at `y = 530`, one under each column.
- **5 ladders** at `x = 40, 170, 310, 450, 600` spanning different floor ranges,
  so the two outer ladders always keep every floor reachable.

Each column starts with four ingredients — top bun, lettuce, patty, bottom bun —
resting on floors 0..3. Ladder x positions never overlap an ingredient's span, so
the chef can always climb without standing on food.

## Mechanics

### Ingredients

An ingredient is 96px wide and split into **4 segments of 24px**. Standing on a
segment presses it down (a small visual dip). When all four segments of an
ingredient are pressed, it falls exactly one floor and comes to rest, with its
segments reset — so each ingredient must be walked several times on its way to
the plate.

**Chaining:** if a falling ingredient reaches a floor already holding another
ingredient of the same column, that one is knocked loose too and both continue
down one more floor. This is how a well-timed drop cascades a whole stack onto
the plate at once.

When an ingredient reaches the plate it is *plated*: it stacks visually on the
plate and can no longer be moved. Four plated ingredients complete a burger; four
complete burgers clear the level.

### Enemies

Enemies walk the floors and climb the ladders using a greedy chase: if the chef
is on a different floor and a usable ladder is within reach, climb toward them;
otherwise walk horizontally toward the chef's x. Enemy speed rises with the
level, but always stays below the chef's speed so escape is possible.

- Touching an enemy costs a life; the chef and all enemies reset to their start
  positions.
- A falling ingredient that overlaps an enemy carries it down and squashes it
  when the ingredient lands (100 points, extra points if the ingredient is on a
  chain drop). Squashed enemies respawn after a short delay.
- Pepper (Space) sprays a cloud in front of the chef. Enemies caught in it are
  stunned for 4 seconds and cannot move.

### Scoring

| Event | Points |
|---|---|
| Ingredient dropped one floor | 50 |
| Ingredient plated | 100 |
| Enemy squashed | 100 (x number of ingredients in the chain) |
| Enemy peppered | 50 |
| Level cleared | 1000 |

Best score is persisted to `localStorage` under `burgertime-best`.

## Controls

| Input | Action |
|---|---|
| Arrow keys / WASD | Walk left-right, climb up-down on a ladder |
| Space | Spray pepper (start / restart when not playing) |
| Enter | Start / restart |
| P | Pause / resume |

## Code shape

`game.js` is a single classic (non-module) script, like Kaboom, Snake and Tetris
in this repo, so every piece of state is reachable from Playwright as a plain
global. All motion is expressed per second and advanced by `step(dt)`, which lets
tests simulate frames deterministically without depending on
`requestAnimationFrame` wall-clock timing. `requestAnimationFrame` only ever calls
`step()` and `draw()`.

State machine: `idle -> running -> (paused) -> levelclear -> running -> ... -> over`.

## Assumptions

These were decided autonomously; the simpler reading was taken each time.

1. **Branch name.** The task asked for a branch named after the game, but this
   session is pinned to the designated branch `claude/loving-euler-en70vf`, so
   all work lands there instead of a `burger-time` branch.
2. **One level layout.** Every level reuses the same girder/ladder map; difficulty
   comes from faster and more numerous enemies rather than new maps.
3. **Whole-ingredient drops.** An ingredient falls as one piece, one floor at a
   time. The arcade original lets each of the four segments dangle at a different
   height; that is modelled here only as the visual dip of a pressed segment.
4. **No enemy variety in behaviour.** Hot dog, egg and pickle differ in colour and
   speed multiplier only; they share one chase routine.
5. **Pepper is a stun, not a kill**, and the stock refills at the start of each
   level.
6. **Falling ingredients do not hurt the chef** — only enemies are squashed.
7. **Fixed canvas size** (640x560), matching the other games in this repo, with no
   responsive re-layout beyond CSS scaling.
