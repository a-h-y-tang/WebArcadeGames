# Golf Solitaire — Design

## Concept

**Golf Solitaire** is a fast, light single-player card game. Thirty-five cards
are laid out face-up in **seven columns of five**. Below them sits a **stock**
and a single **foundation** (waste) pile. You clear the tableau by moving the
exposed (bottom) card of any column onto the foundation whenever it is **one rank
higher or one rank lower** than the current foundation card. When you're stuck,
flip the next card from the stock onto the foundation and keep going. Clear every
tableau card to win the hole.

The name comes from golf scoring: fewer cards left on the table is a better
"score" for the hole.

## Mechanics

- **Layout.** A standard 52-card deck. 35 cards fill the seven columns (5 each,
  all face-up). The remaining 17 cards form the stock; one is flipped up to start
  the foundation, leaving 16 stock draws.
- **Legal move.** Only the **exposed** card of a column (the last / lowest one)
  can be played, and only if its rank differs from the foundation card's rank by
  exactly 1. Ace is low (rank 1), King is high (rank 13). By default there is **no
  wrap-around** — a King (13) and an Ace (1) are *not* adjacent ("no turning the
  corner"), which is the classic rule.
- **Playing a card.** A legal play moves the exposed card onto the foundation,
  shortens that column, and increases your score (cards cleared) by one.
- **Flipping the stock.** Clicking the stock moves its top card onto the
  foundation. This is always allowed while the stock is non-empty and does not
  score.
- **Winning.** Clear all 35 tableau cards → you win.
- **Losing / stuck.** When the stock is empty and no exposed card can be played,
  the hole is over. Your score is the number of cards you cleared.
- **Best.** The most cards cleared in a single hole is persisted to
  `localStorage` under `golf-solitaire-best`.

## Controls

- **Click a column** — play its exposed card onto the foundation (if legal).
- **Click the stock** (or press **Space / Enter**) — flip the next stock card.
- **N** — start a new deal.

## Code structure

Following the repo convention, `game.js` runs in global scope (no module
wrapper) so the Playwright tests can read and drive state directly via
`page.evaluate`.

- **State** lives in top-level `let` bindings: `state`
  (`idle` | `playing` | `won` | `lost`), `score`, `best`, plus the world
  arrays `columns` (7 arrays of cards, bottom = last element), `stock`
  (remaining draw cards), and `foundation` (the current top card, or `null`).
- A card is `{ rank, suit }` with `rank` 1–13 (1 = Ace, 11 = J, 12 = Q, 13 = K)
  and `suit` 0–3.
- **`canPlay(card, foundation)`** is a **pure** predicate — `true` when the card's
  rank is exactly one away from the foundation's. It is the whole rule of the
  game and is exhaustively unit-testable in isolation.
- **`playColumn(i)`, `drawStock()`, `startGame()`, `checkEnd()`,
  `hasAnyMove()`** are small, single-purpose functions. `checkEnd()` runs after
  every play/draw to flip the game into `won` (tableau empty) or `lost` (stock
  empty and no legal move).
- The only randomness is the Fisher–Yates **shuffle** in `startGame()`. Because
  the rule predicate is pure and `columns` / `stock` / `foundation` are directly
  settable, tests build exact positions and assert outcomes deterministically —
  the shuffle is never relied on for correctness.

## Assumptions

- "Novel game not yet in the repo" — there is no Golf Solitaire in the repo. It
  is mechanically distinct from the existing solitaires (Klondike, FreeCell, Peg
  Solitaire) — a seven-column, single-foundation "sequence off the tableau" game.
- The classic **no wrap-around** rule is used (K and A are not adjacent). This is
  the simpler and most common variant; it is noted here in case a wrap-around
  ("around the corner") variant is expected instead.
- All tableau cards are dealt **face-up** (standard Golf) so there is no hidden
  information — every position is fully determined for the player and for tests.
- Score is "cards cleared this hole"; there is no negative/par scoring, which is
  the simpler interpretation of Golf scoring.
- Canvas is 720×520 to fan seven columns of five cards with room for the
  stock/foundation row beneath.
- Preferred model for this work: `claude-opus-4-8`.
