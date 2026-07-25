# Memory Match — Design

## Concept

Memory Match (a.k.a. *Concentration* / *Pairs*) is the classic card‑flipping
memory game rendered on an HTML5 canvas. Sixteen cards lie face‑down in a 4×4
grid, hiding eight pairs of symbols. The player flips two cards at a time: a
matching pair stays face‑up, a mismatch flips back down. Clear all eight pairs
in as few moves as possible.

It is the only card / pair‑matching game in the arcade. It is deliberately
distinct from *Simon* (which tests recall of a growing **sequence**) — Memory
Match tests **spatial** recall of where symbols are hidden.

## Mechanics

- **4×4 board, 8 pairs.** Sixteen cards, each of eight symbols appearing twice,
  shuffled into a random layout at the start of every game.
- **Two‑card flips.** Click (or use the keyboard cursor) to turn a card face‑up.
  - The **first** pick simply reveals a card.
  - The **second** pick reveals another and scores a *move*:
    - **Match** → both cards lock face‑up and the pair counter rises.
    - **Mismatch** → the board briefly locks, then both cards flip back down.
- **Move economy.** Every completed two‑card attempt counts as one move; the
  goal is the fewest moves. The best (lowest) move count is saved to
  `localStorage`.
- **Timer.** A running clock adds a little pressure and is shown on the win
  screen.
- **Win.** When all eight pairs are matched the game is won; the overlay shows
  the moves and time and offers a replay. If the run beat the stored record, the
  best is updated.

## Controls

| Input | Action |
|---|---|
| Mouse click | flip the card under the pointer |
| ← ↑ → ↓ | move the selection cursor |
| Enter / Space | flip the selected card |
| Space / Enter | start / replay (from the overlay) |
| P | pause / resume |
| Start button | start / replay |

## Logic model

The core is deterministic and side‑effect free enough to drive from tests:

- `cards[]` — each `{ symbol, faceUp, matched }`.
- `flipAt(i)` — the single entry point for revealing a card. It enforces every
  rule: ignores clicks when not running, when the board is locked after a
  mismatch, on already‑matched or already‑face‑up cards, and resolves matches or
  arms the mismatch flip‑back.
- `resolveMismatch()` — flips the two mismatched cards back down and unlocks the
  board. In the live game the main loop calls this automatically after a short
  delay; tests call it directly so behaviour is deterministic and timer‑free.
- Winning is detected inside `flipAt` the moment the final pair matches.

Key globals are exposed at file scope for the Playwright suite: `state`,
`cards`, `moves`, `matchedPairs`, `best`, `firstPick`, `secondPick`,
`lockBoard`, `cursor`, `flipAt()`, `resolveMismatch()`, `startGame()`,
`winGame()`, `pauseGame()`, `resumeGame()`, `cardRect()`, and the constants
(`WIDTH`, `HEIGHT`, `COLS`, `ROWS`, `TOTAL_PAIRS`).

## Code structure

- `index.html` — canvas, HUD (moves / pairs / time / best), overlay, controls hint.
- `style.css` — shared visual language with the rest of the arcade.
- `game.js` — all game logic and rendering.
- `tests/memory-match.spec.js` — the Playwright suite, written first (TDD).

## Assumptions

The task left several details open; the simpler interpretation was taken in each
case and recorded here:

- **Fixed 4×4 board (8 pairs).** A single difficulty keeps the first version
  focused; larger boards were left as a future extension.
- **Fewer moves is “better”.** The best score is the lowest move count, shown as
  “—” until the first win. A slower/higher‑move game never replaces a better
  record.
- **Real random shuffle** (`Math.random`) for genuine replay variety. Tests do
  not depend on any particular layout — they either assert layout‑independent
  invariants or set a known deck directly.
- **Mismatch flip‑back is delay‑based in play, immediate on demand in tests.**
  The rule lives in `resolveMismatch()`; the loop merely schedules it, so the
  logic is fully testable without real timers.
- **Symbols are emoji** drawn as canvas text — no external image assets, keeping
  the game a single self‑contained folder like the others.
