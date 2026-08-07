# Marble Popper — Design

A Zuma-style "marble popper" built on a plain HTML5 canvas. A chain of coloured
marbles crawls along a fixed spiral path toward a pit at the centre. The player
sits in the middle of the spiral, aims a launcher, and fires marbles into the
chain. Three or more of the same colour touching each other pop; clear the whole
chain before its head reaches the pit.

## Concept

- One canvas (720×520), one non-module script (`game.js`), no build step.
- The path is an **inward Archimedean-style spiral** sampled into a polyline with
  cumulative arc lengths, so every position along the track is addressed by a
  single scalar `d` (distance travelled, in pixels). `pathPos(d)` converts that
  scalar back into `{x, y}`.
- The chain is an array `balls` ordered **front-first**: `balls[0]` is the marble
  closest to the pit (largest `d`), the last entry is the tail.
- Everything is advanced by `step(dt)` in fixed sub-steps, so the Playwright
  tests can simulate frames deterministically without leaning on
  `requestAnimationFrame` wall-clock timing. Game state lives in plain globals
  for the same reason (the convention used by Kaboom, Snake and Tetris here).

## Mechanics

### Chain motion

Only the **front** marble moves under its own power, at `chainSpeed(level)`
px/s. Every follower is pulled toward `previous.d - BALL_D`, moving at
`CATCH_SPEED` (much faster than the chain) until it touches the marble ahead:

```
balls[i].d = min(balls[i-1].d - BALL_D, balls[i].d + CATCH_SPEED * h)
```

That single rule gives free "gap closing": whenever a pop or an insertion opens a
hole, the rear section rushes forward to close it and then rides along at the
chain's speed again.

Marbles are released from the tail of the queue (`spawnQueue`) at `d = 0`
whenever there is room (`rear.d >= BALL_D`), so a level trickles onto the track
instead of appearing all at once.

### Shooting and insertion

A shot is a free-flying marble (`{x, y, vx, vy, color}`) travelling at
`SHOT_SPEED`. On each sub-step every shot is tested against every on-track
marble; a hit is `distance <= 2 * BALL_R`.

Insertion side is decided by projecting the impact point onto the track: whichever
of `pathPos(hit.d + BALL_D)` / `pathPos(hit.d - BALL_D)` is nearer the shot wins.
Inserting in front of index `i` shifts marbles `i..end` **backward** by one
diameter and splices the new marble in at `i`; inserting behind shifts
`i+1..end` back instead. Pushing the rear (rather than shoving the head toward
the pit) means a shot never costs the player track — the chain re-closes at
`CATCH_SPEED`.

### Matching and combos

After an insertion, the run of same-coloured **touching** neighbours around the
new marble is measured (`matchRun`). Marbles count as touching when their `d`
values differ by no more than `BALL_D + 0.5`, so two separated trains never match
across the gap. A run of 3+ pops.

Combos are resolved immediately rather than waiting for the physical gap to
close: after a pop, if the marbles on either side of the fresh gap share a
colour, the rear section snaps forward and the run is re-tested, with the score
multiplier incremented for each successive pop (`10 × run × combo`).

### Level flow

| Level `L`      | Value                                  |
| -------------- | -------------------------------------- |
| Colours        | `min(3 + floor((L-1)/2), 6)`            |
| Chain length   | `24 + 6 × (L-1)` marbles                |
| Chain speed    | `26 + 4 × (L-1)` px/s                   |

Clearing every marble (queue empty *and* track empty) awards `100 × level` and
starts the next level immediately. Any marble reaching the end of the path
(`d >= PATH_LEN`) ends the run; the best score is persisted to `localStorage`
under `marble-popper-best`.

The next marble's colour is drawn from the colours still in play (chain + queue),
so the launcher never hands the player a dead colour.

## Controls

| Input                          | Action                     |
| ------------------------------ | -------------------------- |
| Mouse move                     | Aim the launcher           |
| Click / <kbd>Space</kbd>       | Fire (also starts a run)   |
| <kbd>←</kbd> / <kbd>→</kbd>    | Rotate the aim             |
| <kbd>S</kbd> / right-click     | Swap loaded and next marble|
| <kbd>P</kbd>                   | Pause / resume             |

## Assumptions

The task brief said to note ambiguous calls here and take the simpler reading:

1. **Branch name.** The brief asks for a branch named after the game
   (`marble-popper`), but this session is pinned to the pre-assigned branch
   `claude/loving-euler-x9u990` and must not push elsewhere. Work is committed
   there; `marble-popper` is used as the game's id in the browser catalogue.
2. **No lives.** A marble reaching the pit ends the run outright instead of
   costing a life and rewinding the chain — the simpler of the two readings.
3. **Immediate combo resolution.** Real Zuma resolves chain reactions as the
   physical gap closes over several frames. Here the gap snaps shut and the
   re-test happens in the same tick, which is deterministic and testable while
   producing the same combos.
4. **Insertion pushes the tail.** A shot never advances the chain's head toward
   the pit; the marbles behind the insertion point are pushed back and catch up.
5. **Misses are free.** A shot that leaves the canvas is discarded with no
   penalty and no ammo cost — the level's queue is the only marble budget.
6. **Colour identity.** Colours are integer indices `0..5` mapped to a palette at
   draw time, which keeps the match logic and the tests free of CSS strings.
7. **Fixed spiral.** Every level uses the same path; difficulty comes from
   length, speed and colour count rather than from new track layouts.
