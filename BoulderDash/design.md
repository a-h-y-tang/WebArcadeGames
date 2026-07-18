# Boulder Dash — Design Document

> This is the design document requested for the game (the task refers to it as
> `DESIGN.md`). It is named `design.md` to match the repository convention —
> the root `README.md` states *"Each game should include a design.md"*, and
> every existing game uses that lowercase name. See **Assumptions**.

## Game Concept

**Boulder Dash** is an underground dig-and-collect game. You control a little
digger burrowing through a cavern of dirt. Scattered through the earth are
**diamonds** to collect and **boulders** that obey gravity — dig the ground
out from under one and it drops, and if it drops on you, you're done. Collect
enough diamonds to unlock the **exit**, then reach it to escape.

Every game in this arcade so far is a shooter, a faller, a paddle game, a
grid puzzle, or a rally. Boulder Dash is the collection's first **dig-and-push
physics** game: the world itself is a simulation of falling, rolling rocks that
you reshape by tunnelling through it. The tension comes from the terrain
reacting to what you dig — clearing a path can bring the ceiling down.

## Mechanics

- **The grid.** The cavern is a 20 × 14 tile grid. Each cell is one of: empty,
  **dirt**, **wall**, **boulder**, **diamond**, or the **exit**. The player
  occupies one cell and moves one cell at a time.
- **Digging.** Moving into dirt clears that cell to empty and steps into it.
  Moving into empty space just steps. Walls are immovable.
- **Collecting.** Moving into a diamond removes it, adds to your collected
  count, and scores points.
- **Pushing.** Boulders can be **pushed sideways** (never up or down): move
  into a boulder horizontally and, if the cell beyond it is empty, it slides
  over one and you follow. Otherwise you're blocked.
- **Gravity.** On each physics tick, every boulder and diamond with empty space
  directly below it **falls** one cell. Anything solid beneath it — dirt, wall,
  or another rock — holds it up.
- **Rolling.** A boulder or diamond resting on top of another *rounded* object
  (a boulder or diamond) will **roll off** to an empty side (preferring left),
  so precarious stacks eventually topple.
- **Getting crushed.** A rock that is already **falling** and reaches the
  player's cell kills the player and ends the run. Standing under a rock that
  is merely *resting* is safe — the danger is motion, exactly as in the
  original.
- **The exit.** The exit stays **locked** (and acts as a wall) until you've
  collected the required number of diamonds; then it opens, and stepping onto
  it wins.

## Controls

| Input | Action |
|---|---|
| ← ↑ ↓ → (or W A S D) | Move / dig in that direction |
| ← / → into a boulder | Push it sideways into empty space |
| P | Pause / resume |
| Space / Start button | Start or restart |

## Architecture

The code follows the same shape as the other games in this repo so the
Playwright tests can drive it deterministically:

- **`index.html`** — the canvas, a HUD (Score / Diamonds collected‑of‑target /
  Best), and a start/pause/game-over overlay with a button.
- **`style.css`** — layout and the warm subterranean theme.
- **`game.js`** — all state lives in top-level (global-scope) variables
  (`grid`, `player`, `state`, `score`, `collected`, plus constants `COLS`,
  `ROWS`, `TILE`, tile codes `EMPTY`/`DIRT`/`WALL`/`BOULDER`/`DIAMOND`/`EXIT`,
  `DIAMONDS_REQUIRED`, `DIAMOND_POINTS`). Player actions and the world
  simulation are separate functions from rendering.

### Two clocks: input and physics

Boulder Dash has two independent update rhythms, and the code keeps them apart:

- **`movePlayer(dx, dy)`** runs immediately on a key press. It handles digging,
  collecting, pushing, and stepping onto the exit. It is a pure function of the
  grid and player position.
- **`step()`** advances the falling-rock physics by exactly one discrete tick.
  The main loop calls it on a fixed `STEP_S` timer via an accumulator, so the
  cave's physics run at a constant rate independent of frame rate. Tests call
  `step()` directly to advance the world one tick at a time.

`step()` processes cells **bottom-up** so each rock settles before the one
above it is considered — that makes a stack of rocks fall correctly (one cell
per tick, no tunnelling) in a single pass. A small `falling` set tracks which
rocks are in motion, which is what distinguishes a lethal *falling* boulder
from a harmless *resting* one directly above the player.

Because both `movePlayer` and `step` are deterministic functions of exposed
state, a test can fill the grid with an exact scenario, set the player's cell,
call the function once, and assert on the resulting grid — no reliance on
wall-clock timing or randomness.

## Assumptions

These choices were made where the brief was open-ended; the guiding rule was
"pick the simpler interpretation and keep going."

1. **Filename.** The task asks for `DESIGN.md`; the repo convention (and the
   root README) call it `design.md`. This file uses the lowercase name to match
   the existing games. It is the design document the task requested.
2. **One fixed, hand-designed level.** Rather than procedural caves, the game
   ships a single deterministic level laid out as a text map. This keeps a new
   game reproducible and makes the tuning (diamond count, reachability)
   predictable. Additional levels could be added as more maps.
3. **A diamond quota, not "all diamonds".** The exit opens after collecting a
   **target** number of diamonds (fewer than the total on the map), mirroring
   the original — there are always more diamonds than you strictly need, so you
   choose which are worth the risk.
4. **One life.** A single falling rock ends the run (no lives or level
   progression in v1), keeping the state machine simple. Score is banked as
   your best in `localStorage`.
5. **Rocks roll left-first.** When a rock can roll either way it prefers left.
   This is an arbitrary but consistent tie-break, chosen for determinism.
6. **Rolling only off rounded objects.** Boulders and diamonds roll off other
   boulders and diamonds, but not off flat dirt or walls — the classic
   "rounded vs. square" rule, simplified to those two rounded types.
7. **Desktop keyboard first.** Controls are designed for a keyboard on a fixed
   640 × 448 canvas (20 × 14 tiles of 32 px).
