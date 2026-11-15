# Chess

The whole game — castling, en passant, promotion, the fifty-move rule and all —
on one HTML5 canvas, against a computer opponent that thinks a few moves ahead.
No build step and no dependencies: open `index.html` in any modern browser.

![Chess](screenshot.png)

## How to play

**Click a piece** to pick it up. Its legal moves appear as dots, and a ring
marks a piece you can take; **click one of them** to move there. Clicking the
piece again, clicking an empty square, or pressing <kbd>Esc</kbd> puts it back
down.

- A pawn that reaches the far rank opens a chooser — queen, rook, bishop or
  knight.
- To castle, move the king **two squares toward the rook**; the rook follows by
  itself. The move is only offered when you still hold the right, the squares
  between are clear, and the king is neither in check nor crossing an attacked
  square.
- A king that is in check **glows red**.
- **Undo** (or <kbd>U</kbd>) takes back your move together with the computer's
  reply. **Flip Board** turns the board around.

### The panel

| Setting | What it does |
|---|---|
| **Opponent** | *Computer*, or *Two players* to play both sides at one keyboard. |
| **Strength** | *Gentle* looks one move ahead and varies its choice, *Steady* looks three, *Sharp* looks four and takes about a second over it. Remembered between visits. |
| **You play** | White or black. Choosing black flips the board and lets the computer open. Takes effect on **New Game**. |

The panel also lists the pieces each side has taken and the moves so far in
standard algebraic notation — `Nf3`, `exd5`, `O-O`, `a8=Q+`, `Ra8#`.

## How a game ends

Every way a real game can finish is in here:

- **Checkmate** — the side to move is in check and has no legal move.
- **Stalemate** — the side to move is not in check and has no legal move.
- **Fifty-move rule** — a hundred half-moves with no capture and no pawn move.
- **Threefold repetition** — the same position, with the same side to move and
  the same castling and en passant rights, for the third time.
- **Insufficient material** — bare kings, a lone minor piece, or bishops on the
  same colour square.

Draws are called as soon as they happen rather than offered as a claim, which
is what a casual game wants.

## How the code works

See [DESIGN.md](DESIGN.md) — the position and move representation, the two-layer
move generator, the alpha-beta search with its quiescence pass, and the test
strategy.

## Tests

The Playwright suite in [tests/](tests/) was written before the game and covers
the rules piece by piece, published **perft** counts from six standard positions
(including the opening position to depth four — 197,281 move paths), every way a
game can end, algebraic notation, the search, and the board's interface.

```powershell
npx playwright test Chess/tests/
```
