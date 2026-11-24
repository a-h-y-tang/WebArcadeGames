# Abide in the Vine — Design

*"I am the vine; you are the branches. If you remain in me and I in you, you
will bear much fruit."* — John 15:5

## Concept

A grid-based growing-trail game: the player steers the **growing tip of a vine**
around a walled garden, gathering **grape clusters**. Every cluster gathered adds
length to the vine, so the garden gets more crowded the better you play. The run
ends when the tip grows into the garden wall, into a trellis stone, or into the
vine's own stem — the vine has tangled and can bear no more fruit.

The genre is the classic grid trail game; the theme changes the names and the
art, not the rules. Internally the trail is `vine`, the food is `grape`, the
bonus food is `fig`, and the obstacles are `stones`.

## Mechanics

### Board

- A 600×400 canvas divided into a **30 × 20 grid** of 20 px cells (`CELL`,
  `COLS`, `ROWS`). All gameplay is in whole cells; nothing moves between cells.
- The vine is an array of `{x, y}` cells, `vine[0]` being the growing tip.
- A run starts with a 4-cell vine at `(8, 10)` facing **right**, one grape on
  the board and no stones.

### Movement

- The game advances in discrete **ticks**. `step(dt)` accumulates elapsed time
  and calls `advance()` once per `tickMs`; `advance()` moves the vine exactly one
  cell. Tests call `advance()` directly, so the simulation never depends on
  `requestAnimationFrame` timing.
- `setDirection(dx, dy)` queues a turn. A turn that reverses the direction the
  tip is *about to* travel is rejected (a vine cannot double back into its own
  stem), as is a turn identical to the pending one. The queue holds at most two
  turns, so two quick key presses in one tick both register — the second is
  applied on the following tick instead of being swallowed.

### Growing and scoring

| Event | Effect |
|---|---|
| Gather a grape cluster | `+10` points, `fruit + 1`, vine grows 3 cells, new grape appears |
| Gather a fig (bonus) | `+50` points, no growth, fig disappears |
| Every 5 grapes | Level up: 2 more trellis stones appear (capped at 16) |
| Every 4th grape | A fig appears for 40 ticks if none is on the board |

- `tickMs = max(TICK_MIN, TICK_BASE − fruit × TICK_STEP)` = `max(70, 140 − 5·fruit)`,
  so the vine speeds up with every cluster and tops out at 70 ms per cell. Speed
  is a pure function of `fruit`, which keeps the simulation reproducible.
- `level = 1 + floor(fruit / 5)` — also a pure function of `fruit`.
- Growth is deferred: gathering sets `growth += 3`, and each tick either consumes
  one unit of `growth` (keeping the tail) or removes the tail cell.

### Collisions

On each tick the tip's next cell ends the run if it is

1. outside the garden wall (`x < 0`, `y < 0`, `x ≥ COLS`, `y ≥ ROWS`),
2. a trellis stone, or
3. part of the vine — **except** the current tail cell when the vine is not
   growing, because that cell is vacated in the same tick.

### Fig and stone placement

- `spawnGrape()` and `spawnFig()` choose uniformly among free cells (not vine,
  not stone, not the other fruit). `spawnFig()` additionally never places a fig
  on the grape.
- New stones avoid the vine, both fruits, and the three cells directly ahead of
  the tip, so a level-up can never drop a stone into the player's face.
- If the vine ever fills the garden so completely that there is no free cell for
  a new grape, the run ends in the win state (`state === 'won'`) — the garden has
  borne all the fruit it can hold.

### States

`idle` → `running` ⇄ `paused`, and `running` → `over` / `won`. The overlay is
visible in every state except `running`. The best score is kept in
`localStorage` under `abide-in-the-vine-best`.

## Controls

- **Arrow keys** or **WASD** — steer the tip.
- **Space** / **Enter** / any steering key — start a run (or restart after one).
- **P** — pause / resume.
- **Swipe** on the canvas — steer on a touch screen; the Start button is a
  normal button, so touch devices can play without a keyboard.

## Rendering

All drawing happens in `draw()` from the state above, so the renderer is purely a
function of the model:

- Soil background with faint furrow lines for the garden rows.
- The vine is drawn tail-to-tip as linked rounded cells in a green gradient,
  with small leaves on alternating segments and a lighter growing tip.
- Grapes are a small cluster of purple berries with a stem; the fig is a deeper
  purple teardrop that blinks over its last 10 ticks.
- Stones are grey rounded squares with a lighter top edge.

## Code layout

| File | Contents |
|---|---|
| `index.html` | HUD, canvas, overlay, help text and the verse |
| `style.css` | Dark panel styling shared in spirit with the other games here |
| `game.js` | Constants, model, `advance()`, `step(dt)`, input, `draw()` |
| `tests/abide-in-the-vine.spec.js` | Playwright suite driving the globals above |

`game.js` is a plain (non-module) script, so `state`, `vine`, `grape`, `stones`,
`advance()`, `startGame()` and friends are globals the Playwright suite can call
directly — the same approach the other games in this repository take.

## Assumptions

These were ambiguous in the brief; the simpler reading was taken and recorded
here.

1. **Walls are solid, not wrapping.** Hitting the garden wall ends the run; there
   is no screen wrap. One life per run, like the classic game.
2. **One grape on the board at a time.** The bonus fig is the only second fruit,
   and it is optional to collect.
3. **Stones are the only extra hazard.** There are no moving enemies; difficulty
   comes from speed, length and the growing number of stones.
4. **Score is flat per fruit** (10 for a grape, 50 for a fig) rather than scaled
   by level — easier to read on the HUD and to reason about in tests.
5. **No sound.** No other game in this repo ships audio assets, so this one
   stays silent too.
6. **Theme over mechanics.** The Christian theme (John 15) is names, colours and
   art only; the rules are the standard grid trail rules, as `CLAUDE.md` asks.
