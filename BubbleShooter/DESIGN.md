# Bubble Shooter — Design

## Concept

A classic **Bubble Shooter** (a.k.a. *Puzzle Bobble*) arcade game rendered on an
HTML5 canvas. A honeycomb of coloured bubbles hangs from the ceiling. You aim a
launcher at the bottom of the screen and fire bubbles upward. When a fired bubble
touches the cluster it snaps into the hexagonal grid. Land three or more of the
same colour together and the whole matching group pops. Any bubbles left dangling
— no longer connected to the ceiling — fall away. Clear every bubble to win.

## Mechanics

### The grid (offset hex packing)

Bubbles live on an **odd-r offset hex grid**:

- Even rows (`0, 2, 4 …`) hold `COLS` bubbles aligned to the left margin.
- Odd rows (`1, 3, 5 …`) hold `COLS − 1` bubbles, shifted right by one radius so
  each nestles between two bubbles of the row above.
- Vertical row spacing is `R · √3` (tight hex packing), where `R` is the bubble
  radius.

Each cell is either `null` (empty) or a colour string. Helper functions convert
between grid coordinates and pixels (`gridToPixel` / `pixelToGrid`) and enumerate
the six hex `neighbors` of a cell (the delta set differs by row parity).

### Firing & snapping

- The launcher sits at the bottom centre. Its aim `angle` is clamped between
  near-horizontal-left and near-horizontal-right so you can never shoot downward.
- `fire()` spawns a `movingBubble` with a velocity from the aim angle. Each frame
  `stepMovingBubble()` advances it; it **bounces** off the left/right walls.
- The shot lands when it reaches the ceiling **or** overlaps an existing bubble.
  It then snaps to the nearest empty grid cell (`nearestEmptyCell`).

### Matching & gravity

`landBubble(r, c, color)` places the bubble and resolves the board:

1. `getCluster(r, c, color)` flood-fills the connected same-colour group.
2. If the group has **3 or more** bubbles, every bubble in it is removed (a *pop*).
3. `getFloating()` then finds all bubbles no longer reachable from row 0; these
   *drop* (are removed too).
4. Score increases by `10` per popped bubble and `20` per dropped bubble — drops
   are worth more to reward chain-clearing setups.

### Win / lose

- **Win:** the board is completely empty (`state = 'won'`).
- **Lose:** a landed bubble sits below the death line (`state = 'lost'`).

### Colour refill

After each shot the launcher's colour advances to the queued `nextColor`, and a
new queued colour is chosen from the colours still present on the board (so the
puzzle always remains solvable). The next colour is previewed beside the launcher.

## Controls

| Input | Action |
|---|---|
| Mouse move over canvas | Aim the launcher toward the pointer |
| Mouse click on canvas | Fire (or start from the intro overlay) |
| `←` / `→` arrow keys | Nudge the aim left / right |
| `Space` / `Enter` | Fire (or start / restart) |

## State model

`state ∈ { 'idle', 'ready', 'firing', 'won', 'lost' }`

- `idle` — intro overlay shown; awaiting first input.
- `ready` — aiming; a shot may be fired.
- `firing` — a bubble is in flight.
- `won` / `lost` — end overlay shown; any start input restarts.

## Testability

Core state and logic are exposed as top-level globals so the Playwright suite can
drive them deterministically without relying on animation timing:

- State: `grid`, `shooter`, `movingBubble`, `score`, `state`, `shotsFired`.
- Constants: `ROWS`, `COLS`, `R`, `COLORS`, `DEATH_Y`.
- Pure helpers: `gridToPixel`, `pixelToGrid`, `neighbors`, `getCluster`,
  `getFloating`, `nearestEmptyCell`.
- Actions: `startGame`, `fire`, `stepMovingBubble`, `landBubble`.

Tests set `grid` cells directly and call `landBubble` to assert popping, floating
gravity, scoring, win and lose transitions — independent of the render loop.

## Assumptions

- **No descending ceiling.** In some Bubble Shooter variants the whole field
  creeps downward every few shots. Per the "simpler interpretation" guidance the
  board here is a fixed starting layout that you clear to win; you can still lose
  by stacking missed shots below the death line. This keeps the hex grid's row
  parity stable and the mechanics easy to reason about and test.
- **Five colours**, five initial rows. Enough variety to be interesting while
  keeping clusters common.
- The launcher starts aiming straight up; aim is clamped so downward shots are
  impossible.
- Best score is persisted to `localStorage` under `bubble-shooter-best`, matching
  the convention used by the Snake game in this repo.
