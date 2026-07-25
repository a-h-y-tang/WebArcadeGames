# Checkers

Classic **Checkers (Draughts)** on an HTML5 canvas. You play the **red** pieces
against a minimax **AI** playing black, on the standard 8×8 board. Slide
diagonally, jump to capture, crown your kings, and wipe out — or box in — the
computer to win.

## How to play

- **Click** one of your pieces to select it; its legal destinations are
  highlighted with green dots.
- **Click** a highlighted square to move there.
- **Captures are mandatory** — if a jump is available you must take it, and
  multi-jumps continue until no further capture is possible.
- Reach the far row to crown a **king**, which can move and jump both forward and
  backward.
- Win by capturing all of the AI's pieces or leaving it with no legal move.
- Press **R** to restart at any time.

## Rules

This is **American / English draughts**: men move and capture forward only;
kings move one square in any diagonal direction (no "flying" kings); captures are
forced.

## Running

Open `index.html` directly in any modern browser — no build step or server
needed.

## AI

The opponent uses **minimax with alpha-beta pruning** (search depth 6 plies),
evaluating material (kings worth more than men) and advancement toward
promotion. It always takes forced captures and is fully deterministic, so the
same position yields the same reply.

## Tests

Playwright tests live in `tests/`. From the repo root:

```powershell
npx playwright test Checkers/tests/
```

See [DESIGN.md](DESIGN.md) for the board model, move-generation rules, and
assumptions.
