# Frostbite — Design

## Concept

A canvas homage to the Activision classic *Frostbite*. You are Frostbite Bailey,
hopping across four rows of drifting ice floes to gather ice blocks and build an
igloo before you freeze. Jump onto a row of **white** floes to harvest a block
(the row turns **blue**); collect enough blocks to finish the igloo, then reach
the top shore and step inside to advance to a colder, faster level. Miss a floe
and you plunge into the water; let the temperature hit zero and you freeze —
either way you lose a life. Lose all three and it's game over.

## Layout

The screen is a stack of six **rows** (top to bottom):

| row | what it is        | safe? |
|-----|-------------------|-------|
| 0   | top shore + igloo | yes   |
| 1   | ice lane (drifts) | only on a floe |
| 2   | ice lane (drifts) | only on a floe |
| 3   | ice lane (drifts) | only on a floe |
| 4   | ice lane (drifts) | only on a floe |
| 5   | bottom shore      | yes   |

Bailey starts on the bottom shore (row 5).

## Mechanics

- **Hopping** — Up / Down hop Bailey one row toward the top / bottom. Left / Right
  slide him along his current row. When he hops onto an ice lane, the game checks
  whether a floe is under him:
  - **On a floe** → he lands safely and rides it.
  - **Over a gap** → he falls in the water and loses a life.
  Shore rows (0 and 5) are always safe.
- **Drifting floes** — each lane is an endless repeating pattern of floes
  (`FLOE_W` wide) separated by gaps (`FLOE_GAP`). Lanes scroll horizontally,
  alternating direction, and speed up each level. While Bailey stands on a lane
  he rides the drift (his x moves with the ice; walls clamp him).
- **Harvesting** — landing on a lane whose floes are **white** turns them blue
  and adds one block to the igloo (score +10). A blue lane gives nothing. When
  **all four lanes are blue** they immediately reset to white so more blocks can
  be harvested.
- **Building the igloo** — the igloo needs `BLOCKS_PER_IGLOO` (15) blocks. Once
  it's complete, hopping onto the **top shore** finishes the level: you bank a
  temperature bonus and advance to the next, faster level with a fresh igloo.
- **Temperature** — a meter counts steadily down. If it reaches zero Bailey
  freezes and loses a life (the meter refills). Completing a level converts the
  remaining temperature into bonus points.
- **Lives** — you start with 3. Any death (water or freezing) costs one and
  resets Bailey to the bottom shore. At zero lives the game ends. The best score
  is stored in `localStorage` under `frostbite-best`.

## Physics / loop

A `requestAnimationFrame` loop computes a delta time (`dt`, clamped after a
backgrounded tab) and calls a single pure `update(dt)` stepper that drifts the
floes, applies held-key horizontal movement, rides Bailey along his floe, and
ticks the temperature. Vertical hops are handled on key-down (discrete). All
motion is in **pixels per millisecond**, so `update(dt)` is frame-rate
independent and can be driven directly from tests for deterministic assertions.
Whether a point sits on a floe is a pure function, `floeUnder(lane, x)`, making
the core collision rule unit-testable.

## Controls

- **← / →** or **A / D** — slide along the current row.
- **↑ / ↓** or **W / S** — hop up / down a row.
- **P** — pause / resume.
- **Space / arrow / Start button** — start or restart from an overlay.

## Assumptions

- **Death only happens at the moment of a hop** (landing over a gap) or when the
  temperature runs out — never from simply riding a floe into a wall. This is the
  simpler, fairer reading and keeps the collision rule a single pure check.
- **Scoring is +10 per harvested (white→blue) lane**, plus a temperature bonus on
  level completion, rather than the original's more elaborate point table. The
  task asks us to prefer the simpler interpretation when ambiguous.
- **All four lanes reset to white together** once all are blue, giving a clean
  harvest rhythm instead of the original's per-floe bookkeeping.
- **Canvas is a fixed 500×500** to match the other games in this repo; no
  responsive resizing, and the six rows are spaced to fit.
- **The original's hazards (birds, crabs, fish) are omitted** for a focused first
  version; difficulty comes from faster drift and a quicker temperature drop each
  level.
