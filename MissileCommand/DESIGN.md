# Missile Command — Design

## Game concept

A browser remake of the 1980 arcade classic. Waves of enemy missiles streak
down from the sky toward your six cities. You defend them by firing
counter-missiles from a central battery: each interceptor flies to the point
you click and detonates into an expanding blast. Any enemy missile caught in a
blast is vaporised. Let a missile through and it takes out a city. Lose every
city and the game is over. Survive a wave — with whatever cities and ammo you
have left earning bonus points — and the next wave comes in faster and thicker.

Rendered on a single 600×500 HTML5 `<canvas>` with vanilla JavaScript — no
framework, no build step. Open `index.html` in any browser.

## Mechanics

- **Cities** — six cities sit along the ground, three either side of the
  battery. Each can be destroyed once. When all six are gone, the game ends.
- **Battery & interceptors** — clicking the field launches an interceptor from
  the central battery toward the click point. It travels in a straight line at
  a fixed speed and, on arrival, detonates into a circular blast that grows to
  a maximum radius and then shrinks away. Ammo is limited per wave.
- **Blasts** — while a blast exists, any enemy missile whose head enters its
  radius is destroyed and scored. Chaining blasts to catch clusters is the core
  skill.
- **Enemy missiles** — spawn at the top and fall in a straight line toward a
  target (a random surviving city, or the bare ground if none remain). Reaching
  a city destroys it. Missile *spawning* uses randomness and therefore lives in
  `updateSpawning` (called from the animation loop), never in `step(dt)`, so the
  core simulation stays fully deterministic and unit-testable.
- **Waves** — a wave is a fixed number of missiles. Once all have spawned, all
  are resolved (destroyed or landed) and all blasts have faded, the next wave
  begins: ammo refills, surviving cities earn a bonus, and enemy speed and
  missile count rise.
- **Scoring** — points per intercepted missile, plus an end-of-wave bonus for
  each surviving city. Best score is persisted to `localStorage` under
  `missile-command-best`.
- **Pause** — `P` toggles pause; while paused nothing advances.

## Controls

| Input | Action |
|---|---|
| Mouse click on the field | Fire an interceptor at that point |
| Click / `Space` / `Enter` | Start the game (from the title / game-over screen) |
| `P` | Pause / resume |
| Start button | Start / resume |

## HUD

Score · Best · Cities remaining · Ammo · Wave.

## Architecture (for testability)

Following the pattern used by the other games in this repo, all game state and
key functions are exposed as globals so Playwright can drive and inspect them
via `page.evaluate`:

- State: `state` (`idle` → `running` → `paused` / `over`), `score`, `best`,
  `wave`, `ammo`, `cities`, `enemyMissiles`, `interceptors`, `explosions`.
- Actions: `fireInterceptor(x, y)`, `spawnEnemyMissile()`, `nextWave()`,
  `startGame()`, `endGame()`.
- Motion is expressed in **pixels-per-millisecond** and integrated by a single
  deterministic `step(dt)`, making the simulation frame-rate independent. The
  animation loop calls the non-deterministic `updateSpawning(dt)` and then
  `step(elapsed)`; tests call `step` directly with a fixed `dt`.

## Assumptions

- **Simpler interpretation preferred, as instructed.** The arcade original had
  three separate batteries (each with its own ammo) and a smart-bomb / MIRV
  splitting enemy; this version uses a single central battery and straight-line
  enemy missiles. Noted here rather than implemented.
- "Lives" in the shared HUD are represented as **cities remaining**, and
  "level" as the **wave** number — the natural mapping for this game.
- Interception is a **circle-vs-point** test (blast radius vs. missile head)
  rather than pixel-perfect trails; this matches how the game reads to play.
- A wave advances only once every missile has spawned and cleared and all
  blasts have faded, so the transition can never strand an in-flight threat.
- Canvas is fixed at 600×500; layout is not responsive beyond that.
- The repo's `playwright.config.js` contained duplicated `const`
  declarations (a bad merge) that made it a syntax error and broke *all*
  tests; this was repaired as part of adding this game so the suite can run.
