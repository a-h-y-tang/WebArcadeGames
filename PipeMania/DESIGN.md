# Pipe Mania — Design

## Concept

Pipe Mania (a.k.a. Pipe Dream) is a race against flowing water. A source
sits on the board and, once released, oozes water one segment at a time.
Before it spills, you lay down pipe segments drawn from a queue so the
water has somewhere to go. Survive by carrying the flow through enough
pipes to hit the level's goal; lose the moment the water reaches an empty
cell, a mis-aligned pipe, or loops back on itself.

## Board

- Grid of **9 columns × 7 rows** (`COLS × ROWS`), each cell **60 px** →
  a **540 × 420** canvas.
- A cell is either empty (`null`) or holds a pipe **type** (a short string).
- The **source** starts in column 0 on a random row and points **East**,
  guaranteeing the water always has an in-bounds cell to flow into. (See
  *Assumptions* — this is the simple, always-playable placement.)

## Pipe types

Each type is a set of open sides (directions `N`, `E`, `S`, `W`):

| Type | Openings | Shape |
|------|----------|-------|
| `H`  | E, W     | horizontal straight |
| `V`  | N, S     | vertical straight |
| `NE` | N, E     | elbow |
| `ES` | E, S     | elbow (south-east) |
| `SW` | S, W     | elbow |
| `WN` | W, N     | elbow (north-west) |
| `X`  | N,E,S,W  | cross / four-way |
| `sN` `sE` `sS` `sW` | one side | the water **source** (single opening) |

## Flow rules

Water is tracked as a *head*: the next cell it will try to enter, plus the
side (`fromDir`) it enters from.

Each `stepFlow()`:

1. If the target cell is off-board, empty, already **filled** (a loop), or
   does **not** have an opening on `fromDir` → the water **spills** →
   `state = 'lost'`.
2. Otherwise fill the cell, `pipesFilled += 1`, and compute the **exit**
   opening:
   - a 2-opening pipe exits by its *other* side;
   - the cross `X` passes straight through (exit = opposite of entry).
3. If `pipesFilled >= goal` → `state = 'won'`.
4. Move the head into the neighbour beyond the exit side.

`goal = 5 + (level - 1) * 2`. Flow speed increases each level.

## Controls

- **Click** an empty cell to drop the current (front-of-queue) piece there.
  The queue shifts and a new random piece is appended.
- **Space** releases the water early (otherwise it auto-releases after the
  build countdown).
- **Enter / any key** on the title screen starts a game; on a finished
  screen it continues.
- **R** restarts the current level with a fresh board.

## HUD

Score (pipes filled), Goal, Level, and Best (most pipes ever filled,
persisted in `localStorage` under `pipemania-best`). A side strip previews
the upcoming pieces with the current one highlighted.

## Testability

All rules are pure functions over global state (`grid`, `queue`, `state`,
`pipesFilled`, `startR/startC/startDir`, `flowHead`, `filled`) exposed on
`window`, exactly like the other games in this repo. `startFlow()` seeds
the flow head **without** starting a timer, so the Playwright suite can
build an exact board, call `stepFlow()` deterministically, and assert the
outcome with zero timing dependence. The real-time loop (`releaseWater()`)
is a thin wrapper that calls `startFlow()` and then drives `stepFlow()` on
an interval.

## Assumptions

- **Source placement**: the source always sits in column 0 and flows East.
  The classic game scatters the source and lets it face any inward
  direction; a fixed edge-East source is the simpler interpretation that is
  always solvable, and it keeps early levels approachable.
- **No overwriting pipes**: you may only drop a piece on an *empty* cell.
  The arcade original lets you overwrite un-flooded pipes for a time
  penalty; disallowing it is simpler and removes an accidental-click
  failure mode.
- **Cross is single-use**: a filled cell is never re-entered, so the cross
  `X` acts as a flexible connector rather than a genuine crossing that
  water can traverse twice. This prevents infinite flow loops with no
  special-casing.
- **Manual/auto release**: water releases on Space, or automatically when
  the build countdown reaches zero. The countdown is generous so there is
  always time to lay a starting run of pipe.
- **Uniform piece queue**: upcoming pieces are drawn uniformly at random
  from the seven playable types (the cross included). No weighting or
  bag-shuffle is applied.
