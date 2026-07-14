# Tron Light Cycles — Design

## Concept

A browser remake of the light-cycle duel from *Tron*. You pilot a glowing
cycle that races around an arena at a constant speed, leaving a solid wall of
light behind it. Your opponent — a CPU cycle — does the same. Neither cycle can
stop or reverse. The moment a cycle drives into a wall, into its own trail, or
into the other cycle's trail, it is destroyed and loses the round. Box the CPU
in before it boxes you in.

It is a *distinct* addition to the arcade: unlike Snake (self-only trail, food)
or Pong (paddles), Tron is a **head-to-head trail-avoidance duel** where the
whole board fills up with lethal walls and space itself is the weapon.

## Mechanics

- **Arena:** a `COLS × ROWS` cell grid (40 × 40) drawn on a 480 × 480 canvas
  (`CELL` = 12 px). A shared occupancy grid `occupied[y][x]` records every cell
  a cycle has driven over: `0` empty, `1` player trail, `2` CPU trail. A cycle's
  current head cell is also marked, so driving into where the other cycle *is*
  is a fatal collision too.
- **Movement is tick-based.** `step()` advances the simulation exactly one cell
  for both cycles and is the deterministic unit the tests drive. The real-time
  loop uses a fixed-timestep accumulator (`TICK_MS` = 60 ms) so the cadence is
  frame-rate independent.
- **Turning.** A queued direction (`pendingDir`) is applied at the start of a
  tick. A 180° reversal into the direction the cycle is already travelling is
  ignored, so you can never turn straight back into your own neck.
- **Collision resolution each tick:** compute both cycles' target cells, then a
  cycle dies if its target is out of bounds, already occupied, or is the *same*
  target another cycle picked this tick (a head-on smash kills both).
- **Rounds & match.** A round ends the instant a cycle dies. The survivor wins
  the round; a mutual smash is a tie and the round is replayed. First to
  `TARGET_WINS` (5) round wins takes the match, ending the game. Between rounds
  there is a brief pause (`ROUND_BREAK` ms) before the arena resets and the next
  round begins with fresh trails.
- **CPU AI.** Deterministic 1-step look-ahead: keep going straight if the cell
  ahead is safe, otherwise turn left if safe, otherwise right; if fully boxed
  in it drives straight and dies. No randomness anywhere, so every behaviour is
  reproducible under test.
- **HUD:** rounds won by You, rounds won by CPU, current Round number, and the
  Best (most rounds you have ever won in a single match), persisted to
  `localStorage` under `tron-best`.

## State machine

`idle → running → (roundover → running)* → over`, plus `paused` reachable from
`running`. `step()` only advances while `running`; `roundover` counts down and
then calls `nextRound()`; `over` shows the match result overlay.

## Controls

| Input | Action |
|---|---|
| ↑ ↓ ← → / W A S D | Steer the cycle |
| Space / any arrow / Start button | Start (or restart after a match) |
| P | Pause / resume |

## Testable surface

The game exposes its live state as page globals — `player`, `cpu`, `occupied`,
`youWins`, `cpuWins`, `round`, `best`, `state`, `lastRoundWinner` — and its
constants `COLS`, `ROWS`, `CELL`, `TARGET_WINS`, plus plain functions
`step`, `startGame`, `nextRound`, `resolveRound`, `endGame`, `pauseGame`,
`resumeGame`. Because `step()` is a pure function of the grid state and there is
no randomness, the Playwright suite sets up an exact board, calls `step()`, and
asserts on the outcome with no reliance on wall-clock timing or RNG.

## Assumptions

Ambiguities were resolved toward the simpler interpretation and recorded here:

- **One CPU opponent, not local two-player.** A single beatable AI keeps the
  game self-contained and gives the tests a deterministic adversary.
- **`DESIGN.md` (uppercase)** is used as the task brief requested; it doubles as
  the design document the repo's README asks each game to include.
- **Best = most rounds won by You in a match** (persisted). It is a meaningful,
  monotonic personal record without needing a separate scoring system.
- **Grid/tick model** rather than free floating-point movement: trails land on
  exact cells, which makes collisions unambiguous and fully testable.
- **1-step-look-ahead AI** (straight → left → right) rather than flood-fill
  space evaluation — competent enough to require boxing it in, small enough to
  stay deterministic.
- **A mutual head-on smash is a tie** and the round is replayed rather than
  awarded to either side.
- **Fixed 480 × 480 canvas** to sit alongside the other games' compact fields.
- **No power-ups, no speed ramp within a round.** Difficulty comes from the
  arena filling with walls, not from acceleration.
