# Golf Solitaire

A fast, light game of patience. Thirty-five cards are dealt face-up into **seven
columns of five**. Clear them all onto a single **foundation** by playing cards
that run **one rank up or down** from the current foundation card. Flip the
**stock** whenever you get stuck.

## How to play

1. The exposed (bottom) card of any column can be played onto the foundation if
   its rank is exactly **one higher or one lower** than the foundation card.
   Ace is low, King is high — and there's **no wrap-around** (a King does not
   play on an Ace).
2. **Click a column** to play its bottom card. Playable columns glow gold.
3. When no column can play, **click the stock** (or press **Space**) to flip its
   next card onto the foundation.
4. **Clear all 35 tableau cards to win.** If the stock runs out and nothing can
   be played, the hole is over — your score is the number of cards you cleared.

Your best (most cards cleared) is saved in the browser (`localStorage`).

## Controls

| Action | Input |
|---|---|
| Play a column's bottom card | **click the column** |
| Flip the stock | **click the stock** or **Space / Enter** |
| New deal | **N** |

## Playing

Open `index.html` directly in a browser — no build step or server required.

## Design

See [DESIGN.md](DESIGN.md) for the rules, the pure `canPlay` predicate, the state
model, and the testing approach.

## Tests

Playwright tests live in `tests/golfsolitaire.spec.js`. From the repo root:

```powershell
npx playwright test GolfSolitaire/tests/
```
