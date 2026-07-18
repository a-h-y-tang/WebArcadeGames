# Whack-a-Mole — Design

## Concept

The classic fairground reflex game on an HTML5 canvas. Moles pop out of a
3×3 grid of holes; you bop each one before it ducks back down. Every hit
scores points; every mole that escapes is a miss. You have a fixed time
budget — rack up the highest score before the clock runs out.

## Mechanics

- **Grid of holes** — nine holes in a 3×3 layout, each independently
  `empty`, `up` (a mole is showing), or `hit` (just bopped, briefly flashing).
- **Spawning** — while the game runs, a spawn timer pops a mole up in a random
  empty hole. As the level rises the interval shrinks and moles stay up for
  less time, so the game speeds up.
- **Whacking** — clicking a hole (or pressing its number key `1`–`9`) while a
  mole is `up` scores points and drops the mole. A hole can only be scored
  once per appearance, so mashing the same hole does nothing extra.
- **Misses** — a mole whose up-timer expires before it is bopped ducks back
  down and counts as a miss.
- **Timer & levels** — the game lasts `GAME_TIME` (30 s). The level rises every
  10 s of elapsed play, quickening spawns. When the clock hits zero the game
  ends.
- **Scoring** — `HIT_POINTS` (10) per successful whack. The best score is
  persisted to `localStorage` under `whack-a-mole-best`.

## Controls

| Input | Action |
|---|---|
| Mouse click | Whack the mole in the clicked hole |
| Keys 1–9 | Whack the corresponding hole (top-left = 1, bottom-right = 9) |
| Space | Start / restart |
| P | Pause / resume |

## Architecture

Mirrors the other games in this repo for consistency:

- Fixed **500×500** canvas; the 3×3 hole grid fills it.
- All meaningful state (`holes`, `score`, `best`, `timeLeft`, `level`,
  `misses`, `state`) plus the constants and pure functions (`step`,
  `startGame`, `popMole`, `whack`, `holeAt`, `endGame`, …) are declared as
  globals so Playwright can inspect and drive them via `page.evaluate`.
- Time is in **milliseconds**; `step(dt)` advances the whole simulation
  (spawn timer, per-mole up-timers, game clock, level) by `dt` ms and is pure
  with respect to time, so tests can fast-forward deterministically without
  relying on `requestAnimationFrame`.
- `state` is one of `idle | running | paused | over`.
- Rendering (`draw`) is isolated from simulation (`step`).

## Assumptions

- **Determinism vs. random spawns.** Real Whack-a-Mole pops moles at random.
  Auto-spawning uses `Math.random` to choose an empty hole, which only affects
  *which* hole lights up. Tests that need determinism set `autoSpawn = false`
  and drive individual moles with `popMole(index)` — the same
  set-up-state-explicitly pattern the Breakout suite uses for the ball.
- **Simpler interpretation chosen where ambiguous:** clicking an empty hole is
  harmless (no miss penalty); there is no combo/streak multiplier; there are
  no "bomb" moles to avoid. These keep the first version focused and clearly
  testable.
- Only one mole is guaranteed at a time via the spawn interval, but the model
  supports several holes being `up` simultaneously.
- A single central home page for the repo is out of scope for this folder;
  the game is openable via its own `index.html`, matching the existing games.
- The pre-existing `playwright.config.js` contained duplicate `const`
  declarations that made it a syntax error (breaking every game's tests). It
  was corrected as part of this work so the suite can run.
