# Stacker — Design

## Concept

Stacker is the classic arcade tower-builder. A block slides back and forth at
the top of a growing tower; you tap to drop it. Whatever part of the block
overhangs the one below is sliced off, so the tower gets narrower with every
imperfect drop. Line a drop up perfectly and you keep your full width (and get
a tiny reward). Miss the stack entirely and the run is over. Score is how many
blocks you managed to stack.

It's the arcade "Stacker" cabinet / the mobile "Stack" game — the name and code
here are original to this repo. It is deliberately unlike anything already in
the repo: there is no gravity platformer, no shooter, no grid puzzle. The whole
game is one recurring decision — *when to drop* — and one satisfying piece of
geometry — *trim the overhang*.

## Mechanics

- **Sliding block.** The active block slides horizontally at a constant speed
  and bounces off the left and right walls. Its speed grows as the tower gets
  taller, so the game gets harder the higher you climb.
- **Drop & trim.** When you drop, the active block is compared against the top
  block of the tower:
  - The horizontal *overlap* between the two becomes the new block.
  - The non-overlapping *overhang* is discarded — the tower narrows.
  - Drop with **zero** overlap and it's **game over**.
- **Perfect drop.** If the block lands (near-)exactly aligned, no width is lost;
  as a small reward the block regrows slightly (up to the original full width),
  so a skilled player can recover from earlier trims.
- **Rising camera & score.** The view follows the top of the tower: each placed
  block scrolls the world down by one block height so the action stays centred.
  Score = blocks stacked. A best score is persisted to `localStorage`.
- **Game over.** A missed (non-overlapping) drop ends the run and shows the
  final score.

## Controls

- **Space / Enter / ↓ / click** — drop the block (and start / restart from an
  overlay).
- **P** — pause / resume.
- **Start / Play Again button** — start or restart with the mouse.

There is intentionally no left/right control: the block moves on its own and the
only input that matters is the timing of the drop.

## Code shape

The code follows the conventions of the other games in this repo so the
Playwright suite can drive it deterministically:

- Motion is time-based (pixels per second) and integrated by `update(dt)` with
  `dt` in seconds. `update(dt)` only slides the active block and has **no**
  `state` gate, so tests can freeze the render loop (`state = 'paused'`) and step
  the simulation exactly.
- The core game logic is `drop()`, a pure, event-driven function: it computes
  overlap, trims the block, grows the tower, scores, spawns the next block, or
  ends the game. It takes no time argument and depends only on the current
  `tower` / `active` state, so tests can set up an exact geometry and assert the
  result.
- Game objects (`tower`, `active`), tunables, and lifecycle functions are plain
  top-level declarations — no modules — so tests read and poke them via
  `page.evaluate`.
- **No randomness and no AI.** The block always starts each level at a wall and
  slides deterministically, so every layout is reproducible without a seed.

### Key functions

- `update(dt)` — slide the active block and bounce it off the walls.
- `drop()` — the trim/score/spawn/game-over step described above.
- `spawnActive()` — create the next sliding block above the tower, matching the
  current top width and ramping the speed with height.
- `startGame` / `endGame` / `pauseGame` / `resumeGame` — the state machine
  (`idle` → `running` → `paused` / `over`).

## Assumptions

- **"Simpler interpretation" of the camera.** Rather than a smooth scroll, the
  world shifts down by exactly one block height per successful drop, keeping the
  active row at a fixed screen position. It's crisp and trivial to reason about.
- **Perfect-drop tolerance.** A drop within a few pixels of perfect counts as
  perfect (keeps/│regrows width). The exact tolerance is a feel choice, not a
  correctness requirement; tests assert the two unambiguous cases (exact overlap
  trims to the overlap; exact alignment keeps full width).
- **Score = blocks stacked.** Simple, transparent, and monotonic, which makes
  "score only goes up" easy to test.
- **Bounded width only shrinks (mostly).** Width can never exceed the original
  block width, so a perfect run stays at full width; trims only ever reduce it
  (perfect drops may regrow it back toward — never beyond — full width).
