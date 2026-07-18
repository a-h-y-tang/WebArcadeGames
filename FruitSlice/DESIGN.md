# Fruit Slice — Design

## Concept

Fruit Slice is a fast reflex arcade game in the spirit of the classic
fruit-slicing games. Fruit is launched up from the bottom of the screen in
arcs; you drag the mouse (or a finger) to slice through them for points. Mixed
in with the fruit are **bombs** — slice one and the game is over. Let too many
pieces of fruit fall past the bottom unsliced and you run out of lives.

## Mechanics

- **Projectile physics.** Every fruit and bomb is a circle launched from just
  below the bottom edge with an upward velocity and some horizontal drift.
  Constant gravity pulls it back down, so each object follows a parabolic arc.
  The whole simulation advances through a single deterministic `step(dt)`.
- **Slicing.** As the pointer is dragged, each mouse movement forms a short line
  **segment** from the previous pointer position to the current one. `slice(x1,
  y1, x2, y2)` tests that segment against every on-screen object using a
  segment-to-circle distance check:
  - Slicing a **fruit** scores it and removes it (leaving a splash of
    particles). Cutting several fruit with a single stroke pays a **combo
    bonus** on top of the base point each.
  - Slicing a **bomb** ends the game immediately.
- **Lives.** You start with **3 lives**. A fruit that falls back below the
  bottom edge *unsliced* costs one life; at zero lives the game ends. Bombs that
  fall away harmlessly cost nothing — not slicing a bomb is the correct play.
- **Spawning.** On a short timer the game launches a small wave of 1–3 objects
  at random horizontal positions, with the chance of a bomb rising slowly as the
  score climbs.
- **Scoring & best.** Score is the total fruit sliced plus combo bonuses. The
  best score is saved to `localStorage` under `fruitslice-best`.

## Controls

- **Mouse / touch drag** — slice. Hold the button (or finger) down and sweep
  across the fruit.
- **Start / Play Again button**, or **Space / Enter** — begin or restart.
- **P** — pause / resume.

## State machine

`ready` → (`running` ⇄ `paused`) → `over` → (restart) → `running`

The overlay is visible in every state except `running`.

## Testability hooks

To stay testable with Playwright and no build step, the core state is exposed as
script-scope globals: `objects`, `particles`, `score`, `lives`, `best`,
`state`, the constants `WIDTH`, `HEIGHT`, `GRAVITY`, and the functions
`startGame()`, `endGame()`, `step(dt)`, `slice(x1,y1,x2,y2)`, `spawnObject(...)`
and `updateHud()`. Because `slice()` and `step(dt)` are pure functions of the
exposed state, tests position objects exactly and assert outcomes with no
reliance on wall-clock timing or `Math.random`.

## Assumptions

- **Simpler where ambiguous.** Two object types only — fruit and bomb. No
  special fruit (freeze, bonus) or power-ups, keeping the rules and tests clear.
- **Slicing is segment-based**, matching how a real drag is sampled frame to
  frame; a single `slice()` call represents one movement segment.
- **A bomb is an instant loss**, as in the original — there is no shield.
- **Fixed 600 × 600 canvas**; not responsive to the viewport.
- **Randomised spawning** uses `Math.random`, but every physics/slice assertion
  sets object positions explicitly first, so randomness never makes a test
  flaky.
- **Score is an integer.**
