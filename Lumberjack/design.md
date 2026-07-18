# Lumberjack — Design

## Concept

Lumberjack is a fast, reaction-based arcade game (in the vein of the classic
"Timberman"). You chop the bottom of a tall tree trunk from the left or the
right. Each chop drops the trunk down one segment and grows a fresh segment at
the top. Branches stick out of the trunk on the left or the right — if a branch
comes down to your side while you're standing there, it knocks you out. A timer
bar is constantly draining, so you can't stop chopping: every chop tops it back
up a little. Score is the number of chops you land before you get hit or run out
of time.

## Mechanics

- The trunk is a vertical stack of a fixed number of visible **segments**
  (`VISIBLE`), index `0` at the bottom (the lumberjack's level) up to the top.
- Each segment carries a **branch** on the `'left'`, on the `'right'`, or
  `'none'`. Branches are generated randomly as new segments scroll in, but never
  in a way that makes survival impossible: a single segment only ever has a
  branch on one side, so the player can always chop the opposite side.
- A **chop** takes a side (`'left'` / `'right'`):
  - The lumberjack moves to that side.
  - The segment currently one above the bottom is about to fall to the player's
    level. **If its branch is on the side the player chose, the player is hit
    and the game ends.**
  - Otherwise the bottom segment is removed, the trunk shifts down, a new random
    segment is appended at the top, the **score** increases by 1, and the timer
    is topped up.
- The **timer** (a value from `0` to `1`) drains continuously while playing; the
  drain rate rises as the score climbs, so the game speeds up. Each chop adds a
  fixed amount back (capped at full). If the timer hits `0`, the game ends.
- The **best** score is stored in `localStorage`.

## Controls

| Action        | Input                                             |
|---------------|---------------------------------------------------|
| Chop left     | `←` / `A`, or click the left half of the canvas   |
| Chop right    | `→` / `D`, or click the right half of the canvas  |
| Start         | any chop input, `Space`/`Enter`, or Start button  |
| Restart       | same inputs after a game over                     |

The first input from the title (or game-over) screen **starts** the round; it
does not also chop. Once running, left/right inputs chop.

## State model

Globals are exposed for testability, mirroring the other games in this repo:

- `state` — `'idle'`, `'running'`, or `'over'`.
- `trunk` — array of `{ branch }` segments, index `0` at the bottom.
- `player` — `{ side }`, the side the lumberjack currently stands on.
- `score`, `best` — integers; `best` mirrors `localStorage['lumberjack-best']`.
- `timer` — remaining time fraction, `0`..`1`.
- Key functions: `startGame()`, `chop(side)`, `endGame()`.

A `requestAnimationFrame` loop drains the timer while `state === 'running'` and
redraws the scene. All game logic (chopping, branch collision, scoring, timer)
lives in plain functions independent of rendering, so it can be driven
deterministically from tests by setting `trunk`/`timer` and calling `chop()`.

## Layout

- Canvas is **400 × 600** (portrait — a tall trunk reads better vertically).
- `VISIBLE = 8` trunk segments; trunk width **70 px**, centred; segment height
  derived from the canvas so the stack fills the play area.

## Assumptions

- **File name.** This document is named `DESIGN.md` as the task requested; a
  lowercase `design.md` with the same content is also included so the folder
  matches the sibling games and the README convention ("Each game should include
  a design.md").
- **Simpler interpretation of losing.** The only ways to lose are (a) chopping
  the side a branch falls onto, or (b) letting the timer run out. There is no
  separate "stuck" detection because a correct chop is always available — the
  challenge is choosing the right side quickly enough.
- **Safe start.** The bottom two segments are branch-free when a round begins so
  the first chop is never an instant, unavoidable loss.
- **Bounded difficulty.** The timer drain rate scales with score up to a cap, so
  the game keeps getting faster but never becomes literally impossible to react
  to within one frame.
- **No pause.** A round is short and driven by rapid single inputs, so there is
  no pause state, keeping the state machine minimal.
