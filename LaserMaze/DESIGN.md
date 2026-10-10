# Laser Maze — Design

## Concept

A single laser emitter fires one beam across a 10 × 8 grid. The beam bounces off
diagonal mirrors, splits at half-silvered splitters, is swallowed by mines and
stopped by walls. Every level drops the player into a board where the beam goes
somewhere useless; the puzzle is to work out which mirrors to turn so the beam
passes through **every** target ring at once, without ever touching a mine.

There is no timer and nothing to react to. The only currency is the move count,
scored against a par that is the provably fewest rotations for that level.

## Mechanics

### The board

Each cell holds exactly one thing:

| Cell | Map char | Behaviour |
|---|---|---|
| Empty | `.` | Beam passes through |
| Wall | `#` | Beam stops at the wall's edge |
| Emitter | `>` `<` `^` `v` | Fires one beam in that direction; absorbs any beam that returns to it |
| Mirror | `/` `\` | Reflects the beam 90°; the player flips it between the two diagonals |
| Fixed mirror | `(` `)` | Same reflection, but cannot be turned — part of the level's scenery |
| Splitter | `A` `B` | Half-silvered: reflects *and* passes the beam through, so one beam becomes two. Also flippable |
| Target | `T` | Lights up when a beam passes through it. The beam keeps going |
| Mine | `*` | Swallows the beam. While any beam reaches a mine the level cannot be solved |

A mirror has only two states, so "rotate" is a toggle: `/` ⇄ `\`. That keeps a
click unambiguous (no hunting for the fourth press to get back) and keeps the
search space small enough that every level's par can be verified exhaustively.

### Beam tracing

`traceBeam()` walks the beam cell by cell from the emitter. Directions are
indices into `DIRS` (0 = East, 1 = South, 2 = West, 3 = North), and each mirror
orientation is a lookup table over those indices:

```
'/'  : E→N  S→W  W→S  N→E
'\'  : E→S  S→E  W→N  N→W
```

Splitters push a second beam onto a stack and carry on, so a board can hold
several live beams. Two details keep the trace honest:

- **Loop guard.** A set of `(cell, direction)` keys is filled as the walk goes.
  Four mirrors can form a closed circuit, and re-entering a cell travelling the
  same way means the beam has started repeating — the walk stops there instead
  of looping forever.
- **Purity.** Tracing never writes to the board. Solving a level in a test (or
  the level-editor script) can brute-force all 2ⁿ orientations by poking states
  and re-tracing, with nothing to undo afterwards.

Collinear cells are merged into one segment, so the renderer draws a handful of
long rays rather than one stub per cell — no seams where the round caps overlap.

### Solving

A level is solved when every target is lit and no beam reaches a mine. The check
runs after every rotation (`retrace()`), so the win fires the moment the last
ring lights. Once solved, the board freezes: further rotations are ignored, which
stops a stray click from undoing the finish and inflating the move count.

Solving stores the best (lowest) move count for that level and unlocks the next
one, both in `localStorage`. A later, worse run never overwrites a better one.

### Levels

Eight hand-authored levels ramp from a single mirror to a four-target board with
two splitters and a fixed mirror. Each was checked by brute-forcing every
combination of its rotatable devices, confirming that:

- at least one combination solves it,
- the authored starting state is *not* already a solution, and
- the recorded `par` equals the smallest number of flips from the start to a
  solution.

The Playwright suite re-runs that brute force against the shipped engine, so a
level map or a reflection rule can never drift away from its par unnoticed.

## Controls

| Input | Action |
|---|---|
| Click a cell | Rotate the mirror or splitter in it |
| Right-click | Same (the two orientations make direction moot) |
| Arrow keys | Move the keyboard cursor |
| Space / Enter | Rotate the device under the cursor |
| `R` | Reset the level to its starting orientations |
| `N` | Next level, once the current one is solved |
| Level buttons | Jump to any unlocked level |

## Code layout

| File | Contents |
|---|---|
| `index.html` | HUD, canvas, solved overlay, level strip, help text |
| `style.css` | Dark lab styling; the canvas scales to the page width |
| `game.js` | Level maps, beam tracer, input, HUD, canvas rendering |
| `tests/lasermaze.spec.js` | Playwright suite (73 tests) |

`game.js` keeps its state on the global scope (`grid`, `beam`, `level`, `moves`,
`state`, `cursor`) and exposes `loadLevel`, `resetLevel`, `rotate`, `traceBeam`,
`retrace`, `solved`, `step` and `draw`, matching the convention the other games
in this repo use so the tests can drive the engine directly instead of only
poking at pixels.

Rendering is a plain `requestAnimationFrame` loop. `step(dt)` only advances
`pulse`, the phase used for the beam flicker, the emitter lens and the glow
around lit rings; nothing about the puzzle depends on time, so a test can set
`autoStep = false` and the board stays exactly where it was put.

## Assumptions

These were decisions made without being able to ask, each resolved toward the
simpler reading:

- **Branch naming.** The task asked for a branch named after the game
  (`laser-maze`), but this session is required to develop and push on its
  designated branch. The designated branch won; no `laser-maze` branch exists.
- **Rotation is a two-state toggle**, not a four-way rotation. With only `/` and
  `\` diagonals available, four states would mean two of every four clicks did
  nothing visible.
- **Mines do not end the game.** Hitting one is a dead end, not a loss: the beam
  is swallowed, a warning appears, and the player simply keeps rotating. The
  alternative (lives, restarts) adds failure states to what is a thinking game.
- **Targets are transparent.** A beam lights a ring and carries on through it,
  so one beam can light several rings in a row. Absorbing targets would force
  every multi-target level to use splitters.
- **Emitters absorb.** A beam that finds its way back into the emitter stops
  there, rather than reflecting or passing through.
- **Par is a score to beat, not a limit.** Going over par is allowed; the HUD
  just shows both numbers and `localStorage` keeps the best run per level.
- **Progress is per-browser.** Levels unlock in order and the unlock point is
  remembered in `localStorage`, so returning to the page resumes at the furthest
  level reached. There is no reset-progress button; clearing site data does it.
- **The game-browser e2e count was left alone.** `game-browser/e2e/game-browser.spec.ts`
  asserts a hard-coded card count that was already stale before this change (109
  against 135 games), so it was not touched — fixing it is unrelated to this game
  and would hide the drift.
