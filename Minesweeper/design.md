# Minesweeper — Design Document

## Game concept

The 1990s desktop classic. A 9 × 9 grid hides 10 mines. Every safe cell, once
revealed, shows how many of its eight neighbours are mines; cells with a count
of zero cascade open to reveal a whole region at once. Flag the cells you
believe are mined, reveal everything else, and don't click a mine. Clearing the
whole field wins; the fastest clear is remembered.

## Architecture

A single, dependency-free HTML page: `index.html`, `style.css`, `game.js`. All
state lives in top-level `let` bindings in `game.js` (`board`, `state`,
`minesPlaced`, `flagCount`, `startTime`) and the core operations are plain
top-level functions (`reveal`, `toggleFlag`, `placeMines`, `computeAdjacency`,
`checkWin`). This mirrors the other games in the repo and lets the Playwright
suite build deterministic boards and assert on results directly.

## Board model

`board[row][col]` is a grid of cell records:

```js
{ mine: false, revealed: false, flagged: false, adjacent: 0 }
```

The board is **9 × 9** with a **40 px** cell, giving a 360 × 360 canvas. Grid
coordinates are integers; only the draw step converts to pixels.

## State machine

`state` gates every action:

```
idle ──► running ──► won
               └───► lost
won / lost ──► running   (Play Again)
```

- **idle** — start overlay; the covered board renders behind it.
- **running** — clicks reveal and flag cells.
- **won / lost** — end overlay; the board is frozen and (on a loss) all mines
  are exposed.

## First-click safety

Mines are **not placed when the game starts** — only on the first reveal, via
`placeMines(safeC, safeR)`. The clicked cell *and its eight neighbours* are
excluded from mine placement, so the opening move can never lose and almost
always opens a region. `minesPlaced` guards against re-scattering on later
clicks.

## Revealing & flood fill

`reveal(c, r)`:

1. On the first call, place mines around the safe cell and start the timer.
2. A flagged or already-revealed cell is ignored.
3. Revealing a mine ends the game.
4. Revealing a cell whose `adjacent` count is **0** triggers `floodReveal` — an
   **iterative** stack-based flood that opens neighbours and keeps expanding
   through any further zero cells (numbered cells are revealed but stop the
   cascade). Iterative rather than recursive so a large open region can't blow
   the call stack.

## Adjacency

`computeAdjacency()` runs once after mines are placed: each non-mine cell counts
the mines among its (up to eight) neighbours. Neighbour iteration is shared by
adjacency counting, flood fill and mine-exclusion via a single `neighbors(c, r)`
generator that already clamps to the board.

## Flagging

Right-click toggles a flag on a covered cell. `flagCount` tracks flags so the
HUD can show **mines remaining = total − flags**. Flagged cells are protected
from reveal.

## Winning

`checkWin()` wins the moment **every non-mine cell is revealed** (rather than
comparing against the mine constant), which is both correct for real play and
robust to the deterministic boards the tests inject. On a win all mines are
auto-flagged and the elapsed time (in whole seconds) is compared against the
stored best.

## Timer & persistence

A light `requestAnimationFrame` loop updates the on-screen timer; the elapsed
value is computed from `startTime` (`Date.now()` at first reveal). The best
(lowest) completion time in seconds is stored in `localStorage` under
`minesweeper-best` and shown as `m:ss`, or `—` when none exists.

## Input

Mouse events are handled on `mousedown` (button 0 reveals, button 2 flags) with
`contextmenu` suppressed, so a right-click flags without opening the browser
menu. Any key from a non-running state (idle / won / lost) starts a fresh game.

## Controls

| Input | Action |
|---|---|
| Left-click | Reveal a cell |
| Right-click | Flag / unflag a cell |
| Any key | Start / restart from the overlay |

## Assumptions

Ambiguities were resolved toward the simpler interpretation and recorded here
per the project's guidance:

- **File name.** The repo convention (and root `README.md`) calls for a
  lowercase `design.md` per game, so this file uses that name; it still serves
  as the requested design document, Assumptions section included.
- **Difficulty.** A single fixed **9 × 9 / 10-mine** "beginner" board is
  shipped — no difficulty selector — to keep scope and the canvas size simple.
- **First-click rule.** The first click clears a 3 × 3 safe zone (cell +
  neighbours), the more forgiving of the common variants.
- **No chording.** Middle-click / double-click "chord" reveal is omitted;
  reveal and flag cover the core loop.
- **Best = time.** "Best" tracks fastest clear time (lower is better), the
  natural Minesweeper score, rather than a points total like the action games.
- **Canvas rendering.** The grid is drawn on a `<canvas>` (with click-to-cell
  coordinate mapping) rather than as DOM elements, to stay consistent with the
  other canvas games in this repo.
- **Test environment browser.** `playwright.config.js` was rewritten to point at
  a pre-installed Chromium (`/opt/pw-browsers/chromium`) when present, falling
  back to Playwright's managed browser otherwise. The version on `main` had
  duplicated `const` declarations that threw a `SyntaxError` and prevented the
  whole suite from loading; this fixes that.
