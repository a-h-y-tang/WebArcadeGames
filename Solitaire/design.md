# Klondike Solitaire — Design

## Concept

Klondike is the solitaire everyone knows — the one that shipped with Windows.
Deal 52 cards into seven tableau columns, a face-down stock, and four empty
foundations. Win by building all four foundations up from Ace to King, one per
suit, moving cards around the tableau in alternating-colour descending runs.

The entire rules engine is a set of small, deterministic functions over plain
card objects, exposed on `window`. The Playwright suite loads exact board states
(`loadState`) and drives moves through those functions, so every rule is
verified without touching a pixel. Rendering and mouse interaction sit on top of
that engine and never contain rules of their own.

## The cards

A card is `{ rank, suit, faceUp }`:

- `rank` — `1` (Ace) … `13` (King)
- `suit` — `'S'` ♠, `'H'` ♥, `'D'` ♦, `'C'` ♣
- `faceUp` — whether its face is visible

Colour: spades and clubs are **black**, hearts and diamonds are **red**.

## Piles

- **stock** — face-down draw pile
- **waste** — face-up pile you draw into from the stock
- **foundations** — four piles, each built **up** in a single suit from Ace to
  King. Foundations are not pre-assigned to suits; the first Ace played to an
  empty foundation claims it.
- **tableau** — seven columns. Cards are fanned down; only the face-up cards at
  the bottom of a column are playable, and they always form a valid
  alternating-colour descending run.

## The deal

`newGame(seed)` shuffles a full 52-card deck with a seeded PRNG (so a given seed
always deals the same game), then deals column `i` (0-based) `i + 1` cards — the
last one face up, the rest face down. The remaining 24 cards become the stock;
the waste and all four foundations start empty.

## Rules

- **Draw.** Clicking the stock moves its top card face-up onto the waste (draw
  one). When the stock is empty, clicking it recycles the whole waste back into
  the stock, face down, ready for another pass.
- **To a foundation.** A card may move to a foundation if the foundation is empty
  and the card is an Ace, or the foundation's top card is the same suit and
  exactly one rank lower.
- **To a tableau column.** A card (or a valid run of cards) may move onto a
  tableau column if the column is empty and the moving card is a King, or the
  column's top card is the opposite colour and exactly one rank higher.
- **Moving runs.** You can pick up any face-up card in a column together with all
  cards below it, provided they form a valid alternating-colour descending run,
  and drop the whole group onto a legal destination.
- **Flipping.** When a move leaves a face-down card at the bottom of a column, it
  flips face up.
- **Foundation → tableau.** A card may be pulled back off a foundation onto a
  legal tableau column (useful to free a needed colour).
- **Winning.** The game is won when all 52 cards sit on the foundations.

## Controls

- **Click the stock** to draw (or, when empty, to recycle the waste).
- **Click a card** to select it (and any valid run beneath it); **click a
  destination** pile to move it there. Click the selected card again to
  deselect.
- **Double-click a card** to send it straight to a foundation if it fits.
- **New Game** button (or <kbd>N</kbd>) deals a fresh game.

The HUD shows the move count and the best (fewest-move) win, persisted to
`localStorage`.

## Exposed API (for tests and debugging)

State: `window.stock`, `window.waste`, `window.foundations` (4 arrays),
`window.tableau` (7 arrays), `window.state`, `window.moves`.

Helpers / rules:

- `makeCard(rank, suit, faceUp)` — build a card
- `newGame(seed)` — deal a fresh, reproducible game
- `loadState({ stock, waste, foundations, tableau })` — install an exact board
- `color(card)` — `'red' | 'black'`
- `canMoveToFoundation(card, fIdx)` / `canMoveToTableau(card, col)`
- `drawFromStock()`
- `moveWasteToFoundation(fIdx)` / `moveWasteToTableau(col)`
- `moveTableauToFoundation(col, fIdx)` / `moveTableauToTableau(fromCol, count, toCol)`
- `moveFoundationToTableau(fIdx, col)`
- `isWon()`

Every move function returns `true` if the move was legal and applied, `false`
otherwise, and never mutates state on a rejected move.

## Assumptions

The prompt left several details open; the simpler interpretation was chosen and
recorded here:

1. **Draw one, not three.** The classic "turn three" variant is harder to reason
   about and to click; this deals one card per stock click, with unlimited
   passes through the stock. The recycle is free.
2. **Unlimited redeals of the stock.** No pass limit is imposed.
3. **Scoring is by move count.** Rather than the arcade "Vegas dollars" scoring,
   the HUD tracks moves and remembers the fewest-move win — a clean,
   deterministic measure.
4. **Foundations are suit-agnostic slots.** Any empty foundation accepts any Ace;
   suit is enforced only for building on top. This matches how most digital
   Klondike lets you drop an Ace on any free foundation.
5. **A single card can be dragged from a foundation back to the tableau**, but
   never a run (a foundation only ever exposes one card).
