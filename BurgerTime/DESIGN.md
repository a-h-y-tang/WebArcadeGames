# BurgerTime — Design

A ladders-and-platforms arcade game on a plain HTML5 canvas, inspired by the
1982 Data East classic. No build step, no dependencies: `index.html` +
`style.css` + `game.js`, tested end-to-end with Playwright.

## Game concept

You are Chef Peter Pepper. Giant burger ingredients are scattered across five
girder floors. Walking the full length of an ingredient makes it drop one floor;
drop every ingredient down onto the plates at the bottom and the burgers are
assembled — level cleared. Meanwhile Mr. Hot Dog, Mr. Egg and Mr. Pickle chase
you around the girders. Touching one costs a life. You can stun them with a
squirt of pepper, or — much more satisfying — flatten them under a falling
ingredient.

## Layout

```
CANVAS 640 × 480

floor 0  ─────────────────────────────   y =  90
floor 1  ─────────────────────────────   y = 162
floor 2  ─────────────────────────────   y = 234
floor 3  ─────────────────────────────   y = 306
floor 4  ─────────────────────────────   y = 378   (chef + enemies start here)
plate    ▂▂▂        ▂▂▂        ▂▂▂       y = 444   (PLATE_FLOOR = 5)

ladders at x = 180, 392, 604 (full height, floor 0 → floor 4)
burger columns at x = 60, 272, 484 (each 96 px = 4 segments of 24 px)
```

Each burger column starts with three ingredients — bun top (floor 0), patty
(floor 1), bun bottom (floor 2) — so nine ingredients per level.

## Mechanics

**Stepping.** An ingredient is divided into `SEG_COUNT` (4) segments. When the
chef stands on a floor and their centre is over a segment, that segment is
pressed down. Press all four and the ingredient drops. Only the *top* ingredient
of a stack is stepped, and when it drops the whole stack under it drops with it —
matching the arcade.

**Falling and pushing.** A falling stack targets the next floor down. If an
ingredient is already resting there, the arriving stack lands on it, that
ingredient joins the group, and the merged stack continues one further floor.
This cascade is the core scoring strategy: line a column up and a single walk
can carry several ingredients several floors.

**Plating.** A stack that falls past floor 4 settles onto the plate
(`floor === PLATE_FLOOR`). When every ingredient in the level is plated, the
level is complete: bonus points, a pepper refill, and a fresh set of
ingredients.

**Enemies.** Enemies walk floors and climb ladders, greedily pathing toward the
chef: same floor → walk toward them; different floor → head for the nearest
ladder and climb toward the chef's floor. Contact with an un-stunned enemy costs
a life and resets the chef and enemies to their start positions (the burger
layout is left as it is). Enemy count and speed scale with the level.

**Pepper.** `Space` sprays a cloud in front of the chef. Enemies caught in it
are stunned for `PEPPER_STUN` seconds and stand still. Pepper is limited
(`PEPPER_START` = 5) and topped up each level.

**Squashing.** Any enemy overlapping a falling ingredient is flattened for
points and respawns after a delay.

## Scoring

| Event | Points |
|---|---|
| Ingredient lands one floor | 50 each |
| Ingredient reaches a plate | 100 each |
| Enemy squashed by a falling ingredient | 300 |
| Enemy stunned with pepper | 20 |
| Level complete | 1000 |

Best score persists in `localStorage` under `burgertime-best`.

## Controls

| Key | Action |
|---|---|
| ← / → / A / D | Walk along a floor |
| ↑ / ↓ / W / S | Climb a ladder (only when lined up with one) |
| Space | Start the game / spray pepper |
| P | Pause / resume |

## Code structure

`game.js` is a single classic (non-module) script, matching Snake, Kaboom and
the other games in this repo: all state and logic live as plain top-level
bindings so Playwright tests can reach them as globals from `page.evaluate`.

- **Constants** — geometry (`CANVAS_W`, `FLOOR_Y`, `LADDER_XS`, `BURGER_X`),
  speeds and scoring, all at the top.
- **`step(dt)`** — the single fixed-signature update entry point. Every motion
  is expressed per second, so tests advance the simulation deterministically
  (`step(0.016)` in a loop) without depending on `requestAnimationFrame` timing.
  `step` is a no-op unless `state === 'running'`, which is what makes pausing
  work.
- **Movers** — the chef and enemies share the same movement primitives
  (`onFloorIndex`, `ladderNear`, `moveAlong`), so climbing rules are identical
  for both.
- **Falling groups** — `fallingGroups` holds `{ col, targetFloor, items }`.
  Keeping the group explicit (rather than per-ingredient physics) is what makes
  the push-cascade simple: merging is a concat, and one landing check drives the
  whole stack.
- **Rendering** — `draw()` is pure output; it reads state and never mutates it,
  so the tests can drive the simulation with the canvas never being painted.

There is no randomness anywhere in gameplay: enemy pathing, spawn timers and
level layouts are all deterministic functions of the state, which keeps the test
suite stable.

## Assumptions

These are decisions taken where the brief or the source material was ambiguous.
Per the instructions, the simpler interpretation was chosen each time.

1. **Branch name.** The task asked for a branch named after the game
   (`burger-time`), but this session is pinned to the designated development
   branch `claude/loving-euler-fojju5`, and pushing elsewhere is not permitted.
   The work is therefore committed to the designated branch.
2. **One level layout.** Every level reuses the same girder/ladder/ingredient
   layout; difficulty comes from more and faster enemies rather than new maps.
   The arcade original has distinct boards per level.
3. **Three ingredients per burger.** The original uses four or five (bun, patty,
   lettuce, cheese, bun). Three keeps a level to a couple of minutes.
4. **No riding or crushing the chef.** In the arcade the chef can ride a falling
   ingredient and can be crushed by one. Here falling ingredients simply pass
   the chef; only enemies interact with them.
5. **A squashed enemy does not add an extra fall level.** In the arcade, an
   enemy caught on an ingredient pushes it one floor further. Here squashing is
   purely points.
6. **One enemy behaviour.** Hot dog, egg and pickle differ only in colour;
   they all share the same greedy chase AI. The original gives them slightly
   different personalities.
7. **Enemies do not use the plate row.** They patrol floors 0–4 only.
8. **Pepper stuns rather than the arcade's "enemy walks away dazed"** — a
   stunned enemy simply stands still until the stun expires.
