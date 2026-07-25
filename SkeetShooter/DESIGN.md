# Skeet Shooter — Design

## Concept

A clay-pigeon shooting gallery. Clay targets are flung from the bottom corners
of the range and arc across the sky under gravity. You swing a crosshair with
the mouse and click to fire; hit the clays before they sail off-screen. Every
clay you let escape is a miss — five misses and the round is over. It's a
fast, mouse-driven test of aim and timing.

It's a fresh genre for this repo: the only other mouse-aim game (Missile
Command) is about *defending* against incoming threats with area explosions,
whereas Skeet Shooter is a precision point-and-click shooting gallery with
projectile-arc targets. Nothing else here is a shooting gallery.

## Mechanics

- **Clays.** Targets launch from either bottom corner with an upward velocity
  and a horizontal velocity aimed toward mid-field. Gravity pulls them into a
  parabolic arc. Launch parameters come from a seeded PRNG so the sequence is
  deterministic.
- **Aiming & firing.** The crosshair tracks the mouse. Clicking fires a single
  shot at the crosshair. A shot **hits** the nearest live clay whose centre is
  within `CLAY_R + HIT_SLOP` of the click; that clay shatters and scores a
  point. Clicking empty sky simply misses — no penalty, but no point either.
- **Escapes = misses.** A clay that leaves the screen on any edge without being
  shot counts as a **miss**. Reaching `MAX_MISSES` (5) ends the round.
- **Difficulty ramp.** The spawn interval shortens as your score climbs, so
  clays come thicker and faster the better you do.
- **Scoring.** One point per clay shattered. The best score persists in
  `localStorage` under `skeet-best`.
- **Game over.** At `MAX_MISSES` the overlay shows the final score and a replay
  button.

## Controls

| Action        | Input                                   |
|---------------|-----------------------------------------|
| Aim           | Move the mouse over the range           |
| Fire          | Left-click                              |
| Pause / resume| `P`                                     |
| Start / replay| Click the range, Space, Enter, or the button |

Firing is mouse-only; there is deliberately no keyboard aiming.

## Architecture notes

The code mirrors the repo's existing games (see `Pong/`, `MissileCommand/`): a
single `game.js` exposes its state and a pure `update(dt)` physics step as
module-level globals so Playwright tests can drive the simulation
deterministically — freeze the loop with `state = 'paused'`, set up clays, call
`update(dt)` or `fireAt(x, y)`, and assert. Neither `update` nor `fireAt` gates
on `state`, so both are pure functions of the world.

Coordinate convention: clays are stored by their **centre** (`x`, `y`) plus a
radius `r`. Motion is time-based (pixels per second) integrated with `dt`.

## Assumptions

- **Ambiguity → simpler interpretation.** Real skeet/trap shooting has fixed
  ammo per round and station rotation; this arcade version uses unlimited shots
  and a miss-based life system, which is livelier and fully testable. The scope
  is the core loop (launch → arc → shoot/escape → score/miss); power-ups and
  multi-clay volleys can be layered on later without changing it.
- **Determinism.** Clay launches use a fixed-seed `mulberry32` PRNG so the
  opening sequence is identical every load; tests that need exact positions set
  up clays directly rather than depending on the RNG.
- **Empty shots aren't punished.** Only *escaped clays* cost you, not wasted
  clicks — it keeps the failure condition unambiguous and easy to reason about.
- **A shot hits at most one clay** (the nearest within tolerance), so a single
  click can't clear a cluster.
- **Canvas size** is a landscape `700 × 500`, matching the other action games
  and giving clays room to arc.
