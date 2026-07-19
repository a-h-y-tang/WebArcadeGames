# ColorFlow — Design

> Note on file naming: the per-game repo convention (and the root README) is a
> lowercase `design.md`, but the project brief asks for `DESIGN.md`. This file
> uses the brief's capitalised name and doubles as the design doc, covering
> every required section: concept, mechanics, controls, and assumptions. A
> short `README.md` sits alongside it for players.

## Game concept

ColorFlow is a single-player "connect the dots" flow puzzle (in the spirit of
*Flow Free*). The board is a rectangular grid seeded with pairs of coloured
endpoints. The player draws a pipe from one endpoint to its matching endpoint
of the same colour. Pipes may not cross each other, and a complete puzzle
requires two things at once:

1. **Connect** — every colour pair is joined by a pipe.
2. **Cover** — every cell of the grid is filled by some pipe.

Connecting the pairs is easy; connecting them *while covering the whole board*
is the puzzle.

## Mechanics

### The grid model

The board is split into two conceptual layers:

- A **static layer** — which cells are endpoints, and of what colour. This
  never changes for a given level.
- A **dynamic layer** — `cellColor[r][c]`, the colour currently occupying each
  cell (an endpoint's own colour, a pipe segment's colour, or empty), plus
  `paths[color]`, an ordered list of cells forming that colour's pipe.

A colour is stored as a single character (`R`, `G`, `B`, `Y`, `O`, `P`, `C`,
`M`), which also indexes a display palette. Levels are authored as arrays of
strings, one character per cell: `.` is an empty cell and any other letter is
an endpoint. Each endpoint letter must appear **exactly twice** — the two ends
of one pipe.

### Drawing a pipe

Drawing is pointer-driven (mouse or touch) and mirrors *Flow Free*:

- **Start** (`startPath(r,c)`): you may begin only on an **endpoint** or on an
  existing pipe cell.
  - Starting on an endpoint discards that colour's current pipe and begins a
    fresh one anchored at that endpoint.
  - Starting mid-pipe truncates the pipe at that cell and continues from there.
- **Extend** (`extendPath(r,c)`): the target must be **orthogonally adjacent**
  to the pipe's current head — diagonal or non-adjacent moves are rejected.
  Then:
  - Target already earlier in this pipe → the pipe **backtracks**, truncating to
    that cell (the natural "undo" of pulling the line back).
  - Target is this colour's *other* endpoint → the pipe is **completed** and can
    extend no further.
  - Target is a *different* colour's endpoint → rejected; endpoints are never
    overwritten.
  - Target is empty, or belongs to another colour's pipe → the cell is claimed.
    If it belonged to another colour, that colour's pipe is **cut** at the
    stolen cell (it loses that cell and everything drawn after it). This is what
    lets a new line carve through an old one.
- **End** (`endPath()`): releases the pointer; the pipe stays as drawn.

### Winning

`isWon()` is true only when **every colour is complete** (its pipe runs endpoint
to endpoint) **and every cell is filled**. Connecting all pairs without covering
the whole board is *not* a win — matching the real game's "you connected them
but the board isn't full" state.

### Levels

The game ships with a handful of hand-authored levels of increasing size (5×5
up to 7×7), each verified to have a full-coverage solution. Clearing a level
reveals a "Solved!" overlay; **Next** advances, and clearing the final level
wins the set.

## Controls

| Input                         | Action                                  |
|-------------------------------|-----------------------------------------|
| Mouse / touch drag            | Draw a pipe from an endpoint or pipe     |
| Release                       | Finish the pipe                          |
| **R**                         | Reset the current level (clear pipes)    |
| **N**                         | Next level (once solved, or to skip)     |
| **Start** / **Next** buttons  | Same as above, via the overlay / HUD     |

## HUD

- **Level** — current level number.
- **Pipes** — connected colours out of total (`x / y`).
- **Flow** — percentage of cells filled.

## Assumptions

These were points the brief left open; the simpler interpretation was taken and
recorded here:

1. **Rendering vs. logic separation.** All puzzle logic lives in a pure model
   with a `window`-exposed API (`loadCustomLevel`, `startPath`, `extendPath`,
   `endPath`, `drawPath`, `isWon`, `getState`, …). Canvas rendering is a thin
   view over that model, so tests exercise mechanics without depending on pixels.
2. **Overwrite semantics.** Drawing over another colour cuts that colour's pipe
   at the stolen cell (loses that cell onward), rather than erasing the whole
   pipe. This matches *Flow Free* and keeps the mechanic learnable.
3. **Win requires full coverage**, not just all pairs connected — this is the
   more interesting (and canonical) rule.
4. **No move/time scoring.** The puzzle is about solving, not speed, so the HUD
   tracks progress (pipes, flow %) rather than a score or timer. Kept simple.
5. **Self-crossing is impossible by construction** — a pipe is a simple path;
   revisiting one of its own cells truncates rather than loops.
6. **Level set is fixed and hand-authored** (no random generation), so every
   shipped level is guaranteed to have a full-coverage solution.
