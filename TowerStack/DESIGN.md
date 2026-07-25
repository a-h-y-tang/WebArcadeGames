# Tower Stack — Design

## Concept

Tower Stack is a one-button reflex/timing arcade game. A single block slides
back and forth across the top of a growing tower. Tap to drop it. Whatever
part of the moving block hangs over the block below is sliced off and falls
away, so the block you keep gets narrower every time you are imprecise. Stack
as high as you can before you miss the tower entirely.

It is a self-contained HTML5 canvas game with no build step — open
`index.html` in a browser.

## Mechanics

The whole simulation is expressed in canvas x-pixels so it is trivial to
reason about and to test. A block is just `{ x, w }` — its left edge and its
width. Vertical position is implicit: a block's row is its index in the
`tower` array (index `0` is the base at the bottom).

- **Base block.** The tower starts with one centered base block of
  `INITIAL_W` (120px) on a `CANVAS_W` (400px) wide canvas.
- **The moving block.** `current` is the block being placed. It sits on the
  row directly above the current tower top and oscillates horizontally,
  bouncing off the left and right canvas walls. Its horizontal speed grows
  with the score (faster = harder), capped so it never becomes unplayable.
- **Dropping.** `dropBlock()` computes the horizontal overlap between
  `current` and the block directly beneath it (the tower top):
  - `overlap = min(curRight, topRight) - max(curLeft, topLeft)`
  - If `overlap <= 0` the block missed the tower → **game over**.
  - Otherwise the placed block is trimmed to exactly the overlapping span
    (`x = max(curLeft, topLeft)`, `w = overlap`), pushed onto the tower, and
    the score increases. The overhang is discarded, so the tower can only get
    narrower over a sloppy run.
- **Perfect drop.** If the moving block is aligned with the one below within
  `PERFECT_TOL` (6px), it snaps to a perfect placement: no width is lost and
  the block *regrows* slightly (up to `INITIAL_W`), rewarding precision and
  giving skilled players a way to recover width. A perfect drop is worth a
  bonus point (2 instead of 1).
- **Next block.** After a successful drop, a new moving block spawns at the
  left wall with the width of the block just placed and starts sliding right.
- **Scoring.** Each successful drop scores 1 (a perfect drop scores 2). The
  best score is persisted to `localStorage` under `tower-stack-best`.
- **Camera.** Rendering scrolls upward as the tower grows so the active block
  always stays in view; the simulation itself is height-agnostic.

## Controls

One button — that is the entire game:

- **Space** / **click / tap on the canvas** / **Start button** — start the
  game, and thereafter drop the moving block.
- After a game over, the same inputs start a fresh run.

## State model (exposed as globals for testing)

Because `game.js` is a classic (non-module) script, its state and helpers are
plain globals, so the Playwright suite can drive and inspect the pure model
without touching pixels:

- `state` — `'idle' | 'running' | 'over'`
- `tower` — array of placed `{ x, w }` blocks, `tower[0]` is the base
- `current` — the moving `{ x, w, dir }` block
- `score`, `best`
- `startGame()`, `dropBlock()`, `endGame()`
- constants `CANVAS_W`, `BLOCK_H`, `INITIAL_W`, `PERFECT_TOL`

The game loop is `requestAnimationFrame`/timestamp-driven (never
`setInterval`), matching the other games in this repo, so speed is
frame-rate independent.

## Assumptions

These choices resolve ambiguities in the concept; the simpler option was
taken each time and recorded here.

- **Trim-only classic rules.** The overhang is sliced and discarded (as in the
  classic "Stack" / "Tower Bloxx" arcade games) rather than the block wrapping
  or physics-toppling. This keeps the model a pure interval-overlap problem.
- **Regrow-on-perfect** is included as the single skill mechanic so a good
  player is not doomed to monotonic shrinking; the regrow amount is small and
  capped at the initial width.
- **Single moving axis.** Blocks only ever move horizontally; there is no
  depth/second axis (some 3D versions alternate axes). Simpler and fully
  testable in 1D.
- **No timer / no lives.** The run ends only on a miss. There is no countdown.
- **Fixed 400×600 canvas**, matching the compact footprint of the other
  single-screen games here.
- The stray top-level `GeoDash/` HTML file (not registered in the root
  README) is unrelated and left untouched.
