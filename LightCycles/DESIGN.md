# Light Cycles — Design

## Concept

Light Cycles is a Tron-inspired arcade duel played on a square grid. You
pilot a cyan light cycle that leaves a solid wall of light behind it as it
moves. An orange CPU cycle does the same. Both cycles move continuously and
can never stop or slow down — you can only steer. Crash into a wall, your own
trail, or the enemy's trail and your cycle is destroyed. The goal is to make
the opponent crash before you do. First to 5 round wins takes the match.

## Mechanics

- The board is a **30 × 30** grid of 20 px cells (a 600 × 600 canvas).
- Both cycles advance exactly **one cell per game step**. Steps fire on a
  fixed timer (`STEP_INTERVAL`), so the game speed is independent of frame
  rate. `update(dt)` accumulates elapsed time and calls `step()` once per
  interval.
- Every cell a cycle enters becomes part of its **trail** and is marked as
  occupied in a `grid` occupancy array (`0` empty, `1` player, `2` CPU).
- On each step both cycles move **simultaneously**. A cycle dies if its next
  cell is:
  - **out of bounds** (a board wall), or
  - **already occupied** by any trail (its own or the enemy's).
- If both cycles try to enter the **same cell** on the same step it is a
  **head-on collision** and both die.
- Round outcome:
  - Only the player dies → **CPU wins the round**.
  - Only the CPU dies → **player wins the round**.
  - Both die → **draw** (no point).
- After a round the board clears and the cycles respawn at their starting
  positions; the match continues until someone reaches `WIN_SCORE` (5).

## The CPU opponent

The AI is fully **deterministic** (no randomness), which keeps the game
reproducible and the tests stable. Each step, before moving, the CPU
evaluates three candidate directions in a fixed priority order —
**straight ahead, then turn left, then turn right** — and takes the first one
whose next cell is safe (in bounds and unoccupied). If no move is safe it
keeps going straight and crashes. This produces believable wall- and
trail-avoiding behaviour while remaining greedy and predictable.

The AI can be toggled off with the `aiEnabled` flag, which the tests use to
script deterministic crash scenarios.

## Scoring & best streak

- **You** / **CPU** in the HUD count round wins for the match.
- **Best Streak** is the longest run of consecutive round wins the player has
  ever achieved, persisted to `localStorage` under `light-cycles-best`.
- The current streak increments on a player round win and resets to 0 on a
  CPU round win. A draw leaves the streak unchanged.

## Controls

- **Arrow keys** or **WASD** — steer up / down / left / right.
- A cycle may not **reverse** directly into itself; the opposite-direction
  input is ignored.
- **P** — pause / resume.
- **Space / Start button** — start the game or play again after a match.
- Any steering key also starts the game from the title screen.

## State machine

`state` is one of:

- `ready` — title screen, overlay visible, nothing moving.
- `running` — the RAF loop calls `update(dt)` and cycles advance.
- `paused` — loop is frozen, overlay shows "Paused".
- `over` — match finished, overlay shows "You Win" or "Game Over".

The requestAnimationFrame `loop()` only calls `update(dt)` while `state`
is `running`; `update()` and `step()` themselves are unguarded so tests can
freeze the loop (by setting `state` away from `running`) and then drive a
single deterministic step directly.

## Testing approach (TDD)

Tests are written first with `@playwright/test`, loading `index.html` via a
`file://` URL. Because game state lives in top-level globals (`player`,
`cpu`, `grid`, `state`, `step`, `update`, `resolveRound`, `DIRS`, …), tests
drive the simulation deterministically with `page.evaluate`:

- Collision detection is tested by positioning cycles, disabling the AI, and
  calling `step()` once.
- Scoring, streaks, and match-win logic are tested by driving
  `resolveRound()` directly after setting `alive` flags.
- Rendering is not asserted pixel-by-pixel; the canvas exists and the
  simulation state is verified through the exposed globals.

## Assumptions

- **Simpler-interpretation choices** (per the task's guidance):
  - The match is best-effort "first to 5"; there is no draw-handling for the
    overall match — draws simply replay the round with no score change.
  - Reversing is silently ignored rather than causing an instant crash, which
    is friendlier and matches the Snake convention already used in this repo.
  - The AI is greedy/deterministic rather than look-ahead or pathfinding —
    enough to be a fun opponent without randomness that would complicate
    testing.
  - Round resets are instantaneous (no "Round 2" countdown), keeping the
    state machine and tests simple.
- Layout and control conventions (overlay markup, `#btn-start`, HUD ids,
  `localStorage` best score, `file://` test loading) mirror the existing
  games in this repo for consistency.
