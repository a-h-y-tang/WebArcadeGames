# Simon — Design

## Game concept

A faithful recreation of the classic 1978 electronic memory toy. The board
is a disc split into four coloured pads (green, red, yellow, blue). Each
round the game flashes a growing sequence of pads; you must repeat it back
in the same order. Every round the machine adds one more step, so the
sequence gets longer and longer until your memory finally slips. Your score
is the length of the longest sequence you reproduced correctly.

This is the first pure **memory** game in the repo — a different genre from
the grid puzzles (Snake, 2048, Tetris), the paddle game (Breakout), and the
action shooters. There is no continuous physics simulation; play is a
turn-based watch-then-repeat loop.

## Mechanics

### Rounds
- A game begins with a one-pad sequence. Each completed round appends one new
  random pad, so round *n* has a sequence of length *n*.
- The game plays the whole sequence back from the start every round
  (flash-on then a short gap between pads), then hands control to the player.

### Player input
- The player reproduces the sequence by activating pads in order (click, tap,
  or number key).
- A correct pad advances the expected position. Completing the sequence
  scores the round and, after a brief pause, begins the next round.
- A single wrong pad ends the game immediately (classic "strict" Simon).

### Scoring
- `score` = the length of the last fully-completed sequence (i.e. rounds
  survived).
- The best score is kept in `localStorage` under `simon-best`.

## Controls

| Action              | Input                                   |
|---------------------|-----------------------------------------|
| Activate a pad      | Click / tap the pad, or press **1–4**   |
| Pad 1 (green)       | top-left · key **1**                    |
| Pad 2 (red)         | top-right · key **2**                   |
| Pad 3 (yellow)      | bottom-left · key **3**                 |
| Pad 4 (blue)        | bottom-right · key **4**                |
| Start / restart     | **Space** / **Enter** or the button     |

## Architecture

- `index.html` — HUD (score / best), the canvas board, and an overlay reused
  for the start, watch, and game-over screens, mirroring the structure of the
  other games in the repo.
- `game.js` — a plain (non-module) script so its top-level bindings are
  reachable from Playwright's `page.evaluate`. Key exposed symbols used by the
  test suite: `WIDTH`, `HEIGHT`, `PADS`, `sequence`, `playerPos`, `score`,
  `best`, `state`, and the functions `startGame`, `endGame`, `addStep`,
  `pressPad`, and `padAtPoint`.

### State machine

`state` is one of:

- `idle` — before the first game (start overlay showing).
- `watch` — the sequence is being played back; player input is ignored.
- `input` — the player's turn to reproduce the sequence.
- `over` — game over (overlay showing).

The game logic (what counts as correct, when a round completes, when the
game ends) is deliberately kept separate from the playback **timers**, so the
whole scoring/failure path can be exercised deterministically by tests
without waiting on the clock: a test can set `sequence`, force `state` to
`input`, and call `pressPad` directly. The timer-driven playback path is
covered separately by a couple of integration tests that wait for the real
`watch → input` transition.

## Assumptions

- **Filename `design.md` (lowercase):** the task brief says "DESIGN.md" but
  every existing game in the repo uses lowercase `design.md` and the root
  README references `design.md`; repo consistency wins.
- **Strict single-mistake game over:** the simpler and most iconic rule. No
  "longest-streak-with-retries" mode, no adjustable difficulty, no sound —
  natural follow-ups.
- **Number-key mapping 1–4** to the pads (reading order: top-left, top-right,
  bottom-left, bottom-right) rather than trying to shoehorn the four pads onto
  arrow keys, which don't map cleanly to a 2×2 layout.
- **Random sequence, no seed required for tests:** tests read the generated
  `sequence` and press accordingly, so they don't depend on the RNG; a seeded
  PRNG is still used so a given session is reproducible for debugging.
- **Fixed playback tempo:** flash and gap durations are constants tuned for
  playability; they are not sped up as the sequence grows (a common Simon
  feature) to keep the first version simple.
