# Tron Light Cycles — Design

## Concept

A single-screen, grid-based rendition of the classic *Tron* light-cycle duel.
You pilot a cyan light cycle around a walled arena; a computer-controlled orange
cycle races against you. Both cycles move continuously and leave a solid,
impassable wall of light behind them. Crash into a wall — the arena border, your
own trail, or your opponent's — and you're out. Force the CPU to crash while you
survive and you win the round.

The game is deliberately built around a **discrete grid** and a **pure
`step()` function** that advances the whole simulation exactly one cell. That
makes every rule — turning, trail-laying, collisions, head-on crashes — fully
deterministic and easy to drive from Playwright tests without relying on wall
clocks or animation frames.

## The arena

- The canvas is **700 × 500** pixels.
- It is divided into a grid of **10 px cells**, giving **70 columns × 50 rows**.
- A single `grid` array (length `COLS × ROWS`) records what occupies each cell:
  `0` = empty, `1` = player trail, `2` = CPU trail. Both cycles' *current*
  positions are always recorded as trail, so a cycle that turns back into the
  cell it just left crashes into its own wall — exactly as it should.

## Cycles and movement

Each cycle is `{ x, y, dir, nextDir }` in **grid coordinates**:

- `dir` / `nextDir` are one of four unit vectors: `up`, `down`, `left`, `right`.
- The player starts at column 10, row 25, heading **right**.
- The CPU starts at column 59, row 25, heading **left** (mirror image).

On every `step()`:

1. Each cycle's queued `nextDir` is applied (a 180° reversal is ignored — you
   can't instantly drive back into your own wall).
2. Each cycle's target cell is computed from its heading.
3. A cycle **crashes** if its target cell is outside the arena or already holds
   any trail. Two extra rules cover cycle-vs-cycle contact:
   - **Head-on:** if both target the same cell, both crash.
   - **Swap:** if each targets the cell the other is leaving, both crash (they'd
     pass through each other).
4. Surviving cycles advance into their target cell, which is stamped into the
   grid as their trail.
5. If either cycle died, the round ends.

Speed is a fixed tick: the real-time loop accumulates elapsed time and calls
`step()` once every `TICK` seconds (~11 steps/second). Rendering is decoupled
from simulation, so frame rate never changes the outcome.

## The CPU opponent

The CPU is a greedy survivor, not a hunter. Before each step it evaluates three
candidate headings — straight, turn-left, turn-right (relative to its current
heading) — and scores each by how many cells of clear space lie straight ahead
of it (a bounded look-ahead). It picks the highest-scoring safe heading, with a
deterministic tie-break order of straight → left → right. This makes the CPU
reliably avoid walls and survive a while, while remaining beatable: it never
actively tries to cut you off, so you win by out-manoeuvring it into a corner.

## Scoring

- **Wins / Losses** are shown in the HUD and accumulate across rounds.
- **Best Streak** is the longest run of consecutive round wins; it is persisted
  to `localStorage` under the key `tron-best-streak`.
- A round win increments the streak; a loss or a draw resets it to 0.

## Controls

- **Arrow keys** or **W A S D** — steer your cycle up / down / left / right.
- **P** — pause / resume.
- **Space / Enter** or the **Start** button — begin a round (and steer, so the
  first key both starts and turns).
- A 180° reversal of your current heading is ignored.

## Game states

`idle` → `running` → (`paused` ⇆ `running`) → `over`, then back to `running` on
restart. The overlay reflects the current state (title + subtitle) and its
`visible` class is present in every state except `running`.

## Assumptions

- **Single arena, no obstacles.** The simplest faithful Tron: an empty walled
  box. No power-ups, multiple lanes, or interior walls.
- **One CPU opponent, best-of-nothing.** Each round is self-contained (win or
  lose, then play again) rather than a first-to-N match — the simpler
  interpretation. Cumulative wins/losses and the best streak give a sense of
  progression instead.
- **Draws are possible** (simultaneous crash) and count as neither a win nor a
  loss, but they reset the streak.
- **Fixed cycle speed.** Constant tick rate rather than accelerating rounds, to
  keep the simulation predictable and the difficulty steady.
- **Trails are permanent** for the whole round (they never fade), matching the
  arcade original and keeping collision rules simple.
