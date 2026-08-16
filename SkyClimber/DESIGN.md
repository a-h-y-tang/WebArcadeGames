# Sky Climber — Design

Sky Climber is a two-handed skyscraper climbing game on an HTML5 canvas. It is
inspired by the arcade classic *Crazy Climber*: the player scales the face of a
building by moving each hand independently between window ledges, while shutters
slam closed under their grip and flower pots rain down from the roof.

Nothing else in this repo plays like it — the novelty is the **split-hand
control scheme**. There is no single "move" input: each hand is a separate
cursor, and climbing only happens when the two hands take turns.

---

## Game concept

You are a climber clinging to the outside of a building. Both hands grip an open
window. Reach the roof to clear the building; each cleared building is taller
and more hostile than the last. Three lives; a shutter closing under a hand or a
falling pot to the skull knocks you down the wall.

## Mechanics

### The wall

The building face is a grid of windows: `COLS = 7` columns wide and
`roofRow + 1` rows tall, with row `0` at street level and row numbers
increasing **upward**. The top row (`roofRow`) is the roof ledge and is always
open and safe.

Level 1's roof is at row `20`; every cleared building adds `5` rows.

### Hands

The climber has a left hand and a right hand, each occupying one grid cell. A
hand moves exactly one cell per key press. A move is legal only when **all** of
these hold for the resulting pair of hand positions:

1. The target cell is inside the grid.
2. The target window is `open` (not `closing`, not `closed`).
3. The two hands are not in the same cell.
4. Column order and spread: `rightCol - leftCol` is `0` or `1` — the left hand
   never crosses to the right of the right hand, and the hands never straddle
   more than two adjacent columns.
5. Vertical spread: `|leftRow - rightRow| <= 1`.

Rule 5 is what makes the game a climb: you cannot walk one hand up the wall, you
must alternate. Rule 4 plus rule 3 means sideways travel needs staggered hands —
lead with one hand into the other's column from a different row, then bring the
trailing hand across.

Height is measured as `min(leftRow, rightRow)`, so a hand reaching up alone does
not bank progress until the other follows.

### Shutters

Every `shutterInterval` seconds a random window inside the visible band changes
state:

- `open` → `closing` for `0.7 s` (telegraphed with a half-drawn shutter). A
  `closing` window cannot be grabbed.
- `closing` → `closed` for `3 s`. If a hand is still on the window when it
  closes, the climber is knocked off the wall.
- `closed` → `open` again.

`shutterInterval` starts at `1.6 s` and drops by `0.1 s` per level to a floor of
`0.7 s`.

### Flower pots

Pots are pushed off the roof at random columns every `potInterval` seconds and
fall straight down at `potSpeed` rows/second. A pot hits when it shares a column
with a hand and comes within `0.7` rows of it. Pots that fall past the street
are removed. `potInterval` starts at `2.2 s` (floor `0.9 s`) and `potSpeed` at
`4 rows/s`, both scaling with level.

### Getting knocked

A shutter closing under a hand or a pot strike costs a life and drops the
climber `3` rows (never below street level). Both landing windows are forced
open so the climber always has something to grab, and a `1.5 s` invulnerability
window prevents an instant second hit. At zero lives the game ends.

### Scoring

- `10` points for every new row of height — re-climbing ground you already
  covered pays nothing.
- `500 × level` bonus for touching the roof.

Best score is persisted in `localStorage` under `skyclimber-best`.

---

## Controls

| Input | Action |
|---|---|
| `W` `A` `S` `D` | Move the **left** hand up / left / down / right |
| `↑` `←` `↓` `→` | Move the **right** hand up / left / down / right |
| `Space` / `Enter` | Start game (also restarts after game over) |
| `P` | Pause / resume |

---

## Code structure

`game.js` is a single classic (non-module) script, matching Snake, Tetris,
BurgerTime and Kaboom! in this repo: all state and helpers are plain globals so
the Playwright specs can reach them directly.

- **State**: `state` (`idle` / `running` / `paused` / `over`), `score`, `lives`,
  `level`, `leftHand`, `rightHand`, `windows`, `pots`.
- **`step(dt)`** advances the whole simulation by `dt` seconds and is the only
  thing the render loop calls, so tests can simulate frames deterministically
  without touching `requestAnimationFrame` or wall-clock time.
- **`moveHand(hand, dx, dy)`** is the single gate for all movement; the key
  handler does nothing but call it.
- **`rng()`** is a seeded LCG (`setSeed(n)`) so pot columns and shutter picks
  are reproducible in tests.
- **`potSpawnEnabled` / `shutterEnabled`** switch off the two random hazard
  sources, which lets long simulations in the specs stay deterministic. Specs
  that are *about* a hazard drive it directly with `spawnPot(col)` or
  `triggerShutter(row, col)`.
- **`draw()`** is pure rendering — the camera follows the climber and nothing in
  it mutates game state.

---

## Assumptions

These were resolved without asking, per the task brief; the simpler reading was
taken every time.

1. **Branch name.** The brief asks for a branch named after the game
   (`sky-climber`), but this session's standing instructions pin all development
   and pushes to `claude/loving-euler-5mainu`. The pinned branch wins; the game
   folder and game id carry the `sky-climber` name instead.
2. **Discrete hands, not analogue joysticks.** The arcade original uses two
   analogue joysticks with continuous arm motion. Here each key press is one
   grid step. It keeps the rules legible and the game fully testable.
3. **One hazard event at a time.** Shutters and pots each spawn on their own
   timer rather than being authored per-building, so buildings are procedural
   rather than hand-designed.
4. **A knock costs a life outright.** In the original a fall can sometimes be
   caught. Here a knock always costs one of three lives and drops the climber a
   fixed three rows — simpler to reason about and to test.
5. **The roof row is always safe.** Shutters are never scheduled on the roof
   row, so the last grab of a building can't be stolen.
6. **No bonus items or window-dwellers.** The original's gorillas, balloons and
   condors are out of scope; the two hazards above carry the difficulty curve.
7. **Height is `min(leftRow, rightRow)`.** Reaching with one hand does not score
   until the other hand follows.
