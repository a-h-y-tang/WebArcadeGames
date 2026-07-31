# Burger Time — Design

## Concept

A single-screen, grid-based arcade platformer in the spirit of the 1982 coin-op
*BurgerTime*. You are a chef trapped on a lattice of floors and ladders,
suspended above three giant plates. Scattered across the floors are the parts of
three hamburgers. Walk the full length of an ingredient and it collapses to the
floor below, knocking whatever it lands on one floor further down. Push every
ingredient onto its plate to serve all three burgers and advance to the next,
faster level.

You are not alone up there. Hot dogs, fried eggs and pickles walk the same
floors and ladders, and one touch costs a life. You carry a shaker of pepper:
a squirt in front of you freezes anything caught in the cloud for a few seconds,
long enough to walk past — or to drop an ingredient on its head, which is worth
far more than merely surviving.

## World geometry

The playfield is a 600×520 canvas.

| Element | Value |
|---|---|
| Floors (walkable y lines) | 80, 180, 280, 380, 470 |
| Ladder centre columns (x) | 30, 120, 210, 300, 390, 480, 570 |
| Walkable x range | 20 … 580 |
| Burger stacks (left edge x) | 60, 240, 420 |
| Ingredient size | 120 × 12 px, split into 4 steppable segments of 30 px |

Floor `4` (y = 470) is the plate floor: the chef can walk it like any other, and
the three plates sit on it. Every ladder connects every pair of adjacent floors,
so the lattice is fully connected — a deliberate simplification over the
original, whose ladders are partial.

Each burger stack holds four ingredients — top bun, lettuce, patty, bottom
bun — one per floor 0–3, so the stack lands on the plate in the right order
without any special-casing.

## The pile model

The unit of movement is a **pile**, not an individual ingredient. A pile is one
or more ingredients sitting at one (stack, floor) slot:

```js
{ stack, floor, ings: ['bunTop', …], steps: [b, b, b, b], state: 'resting' | 'falling', y }
```

`y` is the pile's bottom edge; a pile of `n` ingredients occupies
`[y - n*12, y]`. Modelling piles rather than loose ingredients is what makes the
push-down rule below a two-line operation.

### Stepping

While the chef walks a floor, any resting pile on that floor whose 120 px span
contains him has the segment under his feet marked stepped (and drawn 4 px
lower). When all four segments are stepped the pile drops.

### Falling and the push-down rule

A falling pile descends at 220 px/s toward the next floor down. On arrival:

- **Empty slot** → the pile comes to rest there, its step marks cleared.
- **Occupied slot** → the pile resting there is *pushed*: it immediately starts
  falling toward the floor below it, and the arriving pile takes over the slot.
  If the pushed pile in turn lands on another pile, that one is pushed too, so a
  single drop ripples down the stack one floor at a time.
- **Plate floor** → the ingredients are plated permanently and scored.

This is the behaviour that gives the original game its rhythm: dropping the top
bun does not clear a burger, it shunts the whole column down one floor. Four
passes down the lattice are needed to serve one burger.

A falling pile also squashes any enemy it overlaps.

## Enemies

Two enemies at level 1, one more per level to a maximum of five, cycling through
hot dog → egg → pickle. They use exactly the same movement constraints as the
chef (horizontal only on a floor line, vertical only on a ladder column), and
re-choose a direction every 0.15 s at a decision point: the option that most
reduces the distance to the chef, with a 20 % chance of a random legal move
instead so they can be outmanoeuvred. Reversing is only allowed when it is the
only legal move.

Contact with a moving enemy costs a life and resets both the chef and the
enemies to their starting posts; ingredients keep whatever progress they have
made. A squashed enemy is worth 500 and respawns on the top floor after 5 s.

Randomness comes from a seeded LCG (`setSeed`), so a test can pin enemy
behaviour when it needs to.

## Pepper

Five shakers per level. A squirt paints a 44×30 cloud directly in front of the
chef and stuns everything inside it for 4 s. A stunned enemy neither moves nor
harms the chef, which is the only way past a cornered floor.

## Scoring

| Event | Points |
|---|---|
| Ingredient dropped by stepping | 50 each |
| Ingredient landing on a plate | 100 each |
| Enemy squashed by a falling pile | 500 |
| Level cleared | 1000 |

The best score is kept in `localStorage` under `burgertime-best`.

## Controls

| Input | Action |
|---|---|
| ← → / A D | walk (only while standing on a floor) |
| ↑ ↓ / W S | climb (only while aligned with a ladder) |
| Space | throw pepper — and start / restart the game |
| P | pause / resume |
| Start button | start, restart or resume |

## Code layout

- `index.html` — HUD, canvas, overlay, control legend. No build step.
- `style.css` — diner-sign presentation, shared visual language with the rest of
  the repo (dark board, amber accents).
- `game.js` — a classic (non-module) script so every piece of state is reachable
  from Playwright as a plain global. All motion is expressed per second and
  advanced by `step(dt)` in 1/240 s sub-steps, so tests can simulate frames
  deterministically instead of racing `requestAnimationFrame`.

Test-facing surface: `state`, `score`, `lives`, `level`, `peppers`, `best`,
`chef`, `enemies`, `stacks`, `fallingPiles`, `FLOORS`, `LADDERS`, plus
`startGame()`, `step(dt)`, `setDir(dx, dy)`, `firePepper()`, `setSeed(n)`,
`platedCount()`.

## Assumptions

Decisions made without a human to ask; the simpler reading was taken each time.

1. **Branch naming.** The task asked for a branch named after the game
   (`burger-time`), while the session's standing instructions pin all pushes to
   `claude/loving-euler-yv4or3`. Work was developed on `burger-time` and
   published on the mandated branch, which is the only push target permitted.
2. **Ladders are full-height.** Every ladder connects all five floors. The
   original has partial ladders that shape the routes; a uniform lattice keeps
   the level data trivial and the AI honest.
3. **One fixed layout.** All levels reuse the same lattice and burger placement;
   difficulty comes from enemy count and speed rather than new maps.
4. **Push-down is one floor per contact.** Chained pushes are resolved on
   contact, so a drop ripples rather than teleporting everything to the plate.
5. **Enemies do not ride ingredients.** In the arcade game an enemy standing on
   an ingredient falls with it. Here a falling pile simply squashes what it
   touches.
6. **Stepping is per pile, not per ingredient.** Walking over a pile of three
   ingredients drops all three together.
7. **No bonus items or per-level pepper pickups.** Pepper is refilled to five at
   the start of every level.
8. **Death resets positions only.** Ingredient progress is never rolled back,
   so a life lost is not a level restart.
