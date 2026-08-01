# Burger Time — Design

## Concept

A single-screen arcade game inspired by the 1982 classic *BurgerTime*. You play a
chef trapped on a lattice of platforms and ladders. Four giant burgers hang in
pieces above four plates. Walking the full width of an ingredient makes it drop
one floor; keep walking it down until every piece lands on its plate and the
level is done.

Food is hunting you the whole time. Hot dogs, eggs and pickles climb the same
ladders you do, and touching one costs a life. You carry a limited supply of
pepper — a short-range cloud that freezes anything caught in it — and a falling
ingredient flattens any enemy standing under it for big points.

## Board layout

The board is a fixed lattice, not a tile map:

| Element | Value |
|---|---|
| Canvas | 600 × 500 |
| Floors | 6, surfaces at y = 70, 135, 200, 265, 330, 395 |
| Ladders | 5, at x = 40, 170, 300, 430, 560 — every ladder spans every floor |
| Burger columns | 4, centred at x = 105, 235, 365, 495 |
| Plates | y = 455, one under each burger column |
| Ingredient | 96 px wide (4 steppable segments of 24 px), 12 px tall |

Each burger column starts with four ingredients stacked top-down so the burger
assembles itself correctly as the pieces fall:

| Floor | Ingredient |
|---|---|
| 0 | top bun |
| 1 | lettuce |
| 2 | patty |
| 3 | bottom bun |

Floors 4 and 5 start empty, which gives the chef somewhere to run.

## Mechanics

### Walking ingredients down

An ingredient is divided into four segments. When the chef stands on a floor and
his centre is over a segment, that segment is *stepped* and visibly sags. Once
all four segments of an ingredient are stepped, the ingredient breaks free and
falls (+50 points).

A falling ingredient drops toward the next floor down:

- **Empty floor** — it rests there and becomes steppable again (its segments reset).
- **Occupied floor** — the arriving ingredient takes that floor and knocks the
  resident loose, which falls on to the floor below it (+50 points). One knock
  can start a chain down the column.
- **Plate** — it is added to the plate stack and is out of play. Completing all
  four pieces of a burger is +1000 points.

### Walking and climbing

The chef walks at 90 px/s and climbs at 130 px/s — comfortably faster than the
food, which is what makes escaping possible. Climbing only starts within 8 px of
a ladder, and the chef snaps to a floor the moment he crosses its surface.

Letting go of the climb key mid-ladder leaves the chef hanging there, and a
sideways press does nothing — the arcade behaviour. The one concession: if he
stopped within 14 px of a floor, pressing left or right pulls him on to it
rather than stranding him a few pixels short of a platform he is visibly
standing next to.

### Enemies

Three enemies (a hot dog, an egg and a pickle) walk the floors and climb the
ladders toward the chef using a greedy chase: climb when standing on a ladder
whose direction takes them nearer the chef's floor, otherwise head for the
ladder that is both close by and on the way. Touching an enemy costs a life; the
chef and all enemies reset to their spawn points and the burgers stay exactly
where they were.

Three details keep the chase from being an unfair dogpile, all of them from the
original's feel rather than its code:

- Enemies **enter one at a time** (1.8 s apart at the start of a level, 1.2 s
  after a death) instead of all three converging at once.
- Each enemy **pauses for 0.3 s** when it steps off a ladder on to a floor.
- Each enemy carries a small **ladder preference of its own**, so the pack
  spreads across the board instead of queueing on a single rung.

Enemies are removed two ways:

- **Squashed** — an enemy overlapped by a falling ingredient is flattened. Points
  double for each enemy caught by the same ingredient: 500, 1000, 2000, …
- **Peppered** — a pepper cloud freezes every enemy inside it for 4 seconds. Five
  peppers per level, refilled when a level is cleared.

Squashed enemies respawn after 5 seconds, so clearing the board never becomes safe.

### Progression

Clearing all sixteen ingredients awards a level bonus of 1000 × level, refills the
pepper shaker and rebuilds the burgers. Enemies get faster each level and a fourth
enemy joins from level 3, a fifth from level 5 (capped at five). The chef starts
with 3 lives; the best score is kept in `localStorage` under `burgertime-best`.

## Controls

| Input | Action |
|---|---|
| ← → / A D | Walk |
| ↑ ↓ / W S | Climb (only while standing on a ladder) |
| Space | Throw pepper (also starts the game from the title screen) |
| Enter | Start / restart |
| P | Pause / resume |

## Code structure

- `index.html` — HUD (score, lives, level, peppers, best), canvas, overlay, help text.
- `style.css` — diner-sign presentation, responsive canvas frame.
- `game.js` — one non-module script so Playwright can reach the model directly:
  - **State** — `state` (`idle` → `running` ↔ `paused`, `dying`, `levelclear`, `gameover`),
    `score`, `lives`, `level`, `peppers`, `chef`, `enemies`, `ingredients`, `plateStacks`.
  - **`tick(dt)`** — the whole simulation for one step: chef, stepping, falling
    ingredients, enemies, pepper, collisions. Pure with respect to `dt`, so tests can
    advance the world in exact increments.
  - **`draw()`** — rendering only; never mutates the model.
  - **`frame()`** — the rAF loop, which calls `tick()` (unless auto-ticking is off)
    and then `draw()`.
  - **`input`** — a plain `{left, right, up, down}` object written by the key
    handlers, so tests can drive movement without keyboard timing races.
  - **`setAutoLoop(false)`** — a testing hook that stops the rAF loop from ticking
    while still rendering, letting a test own the clock.

## Assumptions

Choices made where the brief or the original game left room, resolved toward the
simpler option:

1. **Branch name.** The task asked for a branch named after the game
   (`burger-time`), but this session is pinned to the branch
   `claude/loving-euler-85i8c3`. The pinned branch wins; the game name is carried
   by the folder and commit messages instead.
2. **Ladders span every floor.** The arcade original has partial ladders and
   irregular platforms. A full lattice keeps pathing and testing simple and still
   plays well.
3. **A knocked-loose ingredient falls exactly one floor** and the arriving one
   takes its place, rather than the original's "both ride down together". This
   avoids modelling multi-ingredient stacks at intermediate floors while keeping
   the cascade that makes the mechanic fun.
4. **Enemies do not ride falling ingredients.** In the original an enemy standing
   on a dropping piece rides it down and pushes it an extra floor. Here it is
   simply squashed.
5. **No bonus items and no enemy-specific behaviours.** Hot dogs, eggs and pickles
   differ only in colour and are all driven by the same chase logic.
6. **Ingredient segments are not reset when a life is lost.** Progress within a
   level is preserved so a death is a setback, not a restart.
7. **Fixed 600 × 500 canvas.** Consistent with the other games in this repo; the
   CSS scales it down on narrow screens rather than re-laying-out the board.
