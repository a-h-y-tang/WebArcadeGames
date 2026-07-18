# Klondike Solitaire

The classic patience card game — build all four foundations up from Ace to King,
one per suit, to win.

## How to play

1. Open `index.html` in a browser (no build step or server needed).
2. Click **Deal Cards** (or **New Game** / press <kbd>N</kbd>).
3. Uncover cards and build the foundations:
   - **Click the stock** (top-left deck) to turn a card onto the waste. When the
     stock runs out, click it again to recycle the waste.
   - **Click a card, then a destination pile** to move it. Click the selected
     card again to deselect.
   - **Double-click a card** to send it straight to a foundation if it fits.

## Rules

- **Foundations** (top-right) build **up** in a single suit: Ace, 2, 3 … King.
- **Tableau columns** build **down** in alternating colours (e.g. a red 6 on a
  black 7). You can move a whole valid run at once.
- An **empty column** only accepts a **King** (or a run headed by a King).
- Uncovering a face-down card flips it face up automatically.
- You can pull a card back off a foundation onto the tableau if you need it.

Win by moving all 52 cards onto the foundations. The HUD tracks your move count
and remembers your best (fewest-move) win.

## Controls

- **Mouse** — click the stock to draw; click a card then a pile to move;
  double-click to auto-play to a foundation.
- <kbd>N</kbd> — deal a new game.

## Under the hood

See [design.md](design.md) for the full design, the card/pile model, and the
`window`-exposed rules API the Playwright suite drives.

## Tests

```bash
npx playwright test Solitaire/tests/
```
