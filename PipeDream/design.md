# Pipe Dream — Design Document

> This is the design document requested by the task (which refers to it as
> `DESIGN.md`). It is named `design.md` to match the repository convention — the
> root `README.md` states *"Each game should include a design.md"*, and the
> existing games use that lowercase name. It covers all requested sections:
> **concept, mechanics, controls, and assumptions**. See **Assumptions**.

## Game Concept

**Pipe Dream** (a.k.a. *Pipe Mania*, 1989) is a race against a rising tide of
green **ooze**. A source sits on the board with a single open end. After a short
head start, ooze begins pouring out of it and creeps forward one pipe at a time.
Your job: click empty tiles to lay pipe from an ever-refilling queue, building a
connected path *ahead* of the ooze so it always has somewhere to go. Connect
**20** pipes before it leaks and you win; let it hit a dead end, a misaligned
pipe, or the board edge and it's game over.

Every other game in this arcade is a shooter, a faller, a paddle game, or a
grid-logic puzzle. Pipe Dream is none of those — it's a **routing / plumbing**
game built on real-time pressure, and it's a genuinely distinct addition.

## Mechanics

- **The queue.** You always place the **front** piece of a 5-deep queue of
  upcoming pipes; the tray shows what's next so you can plan. Placing a piece
  advances the queue and draws a fresh one in.
- **Pieces.** Seven pipe types: two straights (─ │), four curves (└ ┌ ┐ ┘), and a
  cross (┼). Each type connects a fixed set of sides. A curve turns the flow 90°;
  the cross lets the flow run straight through.
- **Laying pipe.** Click any empty tile to drop the current piece there. You
  **cannot** build over an occupied tile (including the source) or off the board.
- **The flow.** After `FLOW_START_DELAY` seconds of head start, the ooze advances
  one pipe every `FLOW_TIME` seconds. Each advance the ooze tries to move in its
  current heading into the next tile. That tile must (a) exist, (b) hold a pipe,
  and (c) have an opening on the side the ooze arrives from. If all three hold,
  the pipe fills (green), your score rises, and the ooze exits the pipe's other
  end — turning at curves, continuing through a cross. If any fail, the ooze
  **leaks** and the game ends.
- **Scoring & winning.** Score is the number of pipes the ooze has filled.
  Reaching `TARGET` (20) filled pipes wins. Your best score persists across
  sessions.

## Controls

| Input | Action |
|---|---|
| Click an empty tile | Place the next queued pipe there |
| Click (on the idle / end screen) | Start a new game |
| P | Pause / resume |
| Start / Play Again button | Start / restart |

Pipe Dream is a mouse game (like Minesweeper in this collection); no keyboard
steering is needed beyond pause.

## Architecture

A single static page — `index.html`, `style.css`, `game.js` — with no build step
or dependencies. Open `index.html` directly in a browser.

### Board & piece model

The board is a **COLS × ROWS** grid (12 × 9) of `CELL`-pixel tiles, so the canvas
is exactly **672 × 504**. `grid[y][x]` is `null` or `{ type, filled }`. A pipe
`type` maps through the **`PIECES`** table to the set of sides it connects
(`['N','E','S','W']` subset). The **source** is a special piece filled at start
whose single opening is `START.dir`.

Directions are the four unit vectors in `DVEC`, with `OPP` giving the opposite
side. The rule tying it together: *an opening on side `X` means the pipe connects
to the neighbour in direction `X`*, so when the ooze exits through opening `X` it
travels in direction `X` and enters the next tile on side `OPP[X]`.

### `flowStep()` — one deterministic advance

All flow logic lives in **`flowStep()`**: from the flow head `{x, y, dir}` it
computes the next tile, checks bounds / presence / opening alignment, fills the
tile and scores, then derives the exit (straight-through for a cross, "the other
opening" otherwise) and moves the head. It returns `'flow'`, `'leak'`, or
`'win'`, reads no wall-clock, and uses no randomness — so a test can hand-build
an exact board, call `flowStep()`, and assert the outcome.

### `update(dt)` / the loop

`update(dt)` is the real-time driver: it burns down the head-start `flowDelay`,
then accumulates `dt` and calls `flowStep()` once per `FLOW_TIME` elapsed
(fixed-timestep, frame-rate independent). The `requestAnimationFrame` loop calls
`update(dt)` then `draw()`. Keeping `flowStep()` separate from `update()` is what
makes the core both real-time *and* unit-testable.

### Deterministic queue

The upcoming pieces are drawn from a weighted pool via a small **LCG** seeded to
a fixed value at `startGame()`. This gives variety while keeping every game
reproducible — important for testing and fair play. Curves and straights are
common; the cross is rare.

### State machine

`state` moves `idle → running`, `running ↔ paused`, and `running → over` /
`running → win` (then `→ running` on restart). The overlay is shown for every
non-`running` state with a context-specific title.

### Rendering

Each frame draws the tile grid, then every pipe as rounded stubs from the tile
centre to each of its openings plus a hub — gold for the source, green (glowing)
when filled, grey when dry — and a highlight box on the flow head once the ooze
is moving. The upcoming tray is drawn to small DOM canvases.

### Persistence

The best score is stored in `localStorage` under `pipe-best`, read on load and
written only when beaten.

## Assumptions

- **Design-doc filename.** The task says *"DESIGN.md"*; the repo convention (and
  the root README's explicit requirement) is `design.md`. I used `design.md` to
  match the existing games, and added a per-game `README.md` as the repo also
  requires. This file fulfils the requested sections.
- **Simpler placement rule.** The arcade original lets you bulldoze an unfilled
  pipe (with a time penalty) and cross pipes with a dedicated cross tile. I took
  the simpler interpretation: you place only on **empty** tiles, and the cross is
  just another queued piece that runs the flow straight through. This keeps the
  rules clear and the logic cleanly testable.
- **Win at a target length.** Rather than an endless survival score, reaching
  `TARGET` (20) filled pipes wins the match — a concrete, testable goal — while
  the best *score* is still tracked and persisted.
- **Deterministic queue.** The piece queue uses a seeded LCG (fixed seed per
  game) instead of `Math.random()`, so behaviour is reproducible in tests and
  identical across runs.
- **Board 12 × 9 at 56 px.** Chosen to give room to route while keeping the
  672 × 504 canvas comparable to the other games; exposed as
  `COLS`/`ROWS`/`CELL`/`WIDTH`/`HEIGHT`.
- **Mouse control.** As a placement puzzle, Pipe Dream is played with the mouse
  (like Minesweeper here); the only key is `P` to pause.
- **Head start & flow speed.** `FLOW_START_DELAY` (6 s) and `FLOW_TIME` (0.85 s
  per pipe) are tuned so the game is beatable with steady planning but tightens
  as the ooze catches up; both are exposed constants.
