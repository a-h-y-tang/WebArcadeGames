# Frogger — Design Document

## Architecture

A single HTML page with no dependencies: `index.html`, `style.css`, and
`game.js`. Every piece of game state and the helper functions are declared at
the top level of `game.js`, so they live in the page's global scope. This keeps
the code simple and lets the Playwright suite drive and inspect the game
directly (`frog`, `obstacles`, `bays`, `state`, `score`, `lives`,
`moveFrog()`, `die()`, `resolveGoal()`, …) — the same convention the other games
in this repo use.

## Grid & Layout

The board is a **13 × 13 grid** of 40 px cells → a 520 × 520 canvas. Rows, from
the top:

| Row(s) | Zone | Behaviour |
|---|---|---|
| 0 | Home | five goal **bays** at fixed columns; land in an empty bay to score |
| 1–5 | River | log lanes — you **drown** unless standing on a log |
| 6 | Median | safe |
| 7–11 | Road | car lanes — a car **runs you over** |
| 12 | Start | safe; the frog spawns here (centre column) |

The frog hops one cell per key press. Horizontal position is clamped to the
board; it can never move below the start row, and moving up into row 0 triggers
goal resolution.

## Coordinates

Obstacles (logs and cars) move **continuously in pixels**; the frog hops on the
grid but its `x` can drift sub-cell while riding a log. Collision uses the
frog's **centre x** against each obstacle's `[x, x + width]` span within the same
row — simple, forgiving, and deterministic.

## Deterministic Lanes

Every lane is described by a static `LANES` entry (`row`, type, direction,
speed, obstacle count, length). Obstacles are laid out at evenly-spaced start
positions with **no `Math.random`**, so the world is fully reproducible — a
requirement for reliable tests. Each obstacle moves `dir · speed · dt` per frame
and wraps to the opposite edge when it leaves the screen.

## Game Loop

`requestAnimationFrame` drives the loop. Each frame computes a real delta-time
`dt` (seconds, capped at 50 ms to avoid huge jumps after a tab switch), advances
obstacles, resolves the frog's interaction with its current lane, and redraws.

## Frog–Lane Resolution

Each frame, the frog's current row decides what happens:

- **Road:** if any car in that row overlaps the frog → `die()`.
- **River:** if the frog is on a log, it **rides** with that log
  (`frog.x += dir · speed · dt`); being carried off either edge → `die()`. If it
  is on water but on no log → `die()` (drown).
- **Safe / start / median:** nothing.

Reaching row 0 is handled at hop time: `resolveGoal()` checks whether the frog's
column matches an unfilled bay. A hit fills the bay and scores; a miss (wrong
column or an already-filled bay) is fatal.

## State Machine

`state` is one of four values, mirroring the repo's other games:

```
idle ──► running ──► paused ──► running
                 └──► over ──► running
```

## Scoring

- **+10** each time the frog advances to a row nearer the goal than it has
  reached this trip (`maxRow`).
- **+50** for landing in a bay.
- **+100** bonus for filling the last bay of a set, which also advances the
  **level**: bays reset and every obstacle speeds up by 15 %.

## Lives & Game Over

The frog starts with **3 lives**. Any death decrements `lives` and respawns at
the start cell; at 0 lives the game ends and the best score is persisted.

## Persistence

`localStorage` stores the all-time best score under `frogger-best`, read on load
and written only when beaten.

## Assumptions

- **`design.md` vs `DESIGN.md`:** the task asked for a `DESIGN.md`, but every
  existing game in this repo (and the root `README.md`) uses lowercase
  `design.md`. To stay consistent with the established convention this file is
  named `design.md`; it contains the requested content, including this
  Assumptions section.
- **Logs only, no turtles/diving:** the river uses only logs — the simpler
  interpretation of "stand on something floating" without diving turtles.
- **Center-based collision** rather than full box overlap — forgiving and easy
  to reason about; the simpler choice that still feels fair.
- **Deterministic obstacle layout** (evenly spaced, no RNG) so the game is
  reproducible and testable; only difficulty (speed) scales with level.
- **Canvas is 520×520** to fit a 13×13 grid of 40 px cells; a presentation
  choice with no logic impact.
