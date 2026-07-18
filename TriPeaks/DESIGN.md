# TriPeaks Solitaire — Design

## Concept

TriPeaks is a fast, single-deck solitaire built around **three overlapping
pyramids** of cards. You clear the tableau by playing cards that are one rank
**above or below** the top of the waste pile (ranks wrap, so Ace joins both
King and Two). When you're stuck, you flip a fresh card from the stock. Clear
all 28 tableau cards to win.

It's a distinct genre from the repo's existing card games — Klondike and
FreeCell are *build-the-foundations* games, while TriPeaks is a *rank-ladder
sequencing* game with no suits, no foundations, and a streak-based score.

## The board

28 cards are dealt face-up into four rows forming three peaks:

```
Row 0:      ▲        ▲        ▲          3 cards  (the peaks)
Row 1:    ▲  ▲     ▲  ▲     ▲  ▲         6 cards
Row 2:   ▲ ▲ ▲    ▲ ▲ ▲    ▲ ▲ ▲        9 cards
Row 3:  ▲ ▲ ▲ ▲ ▲ ▲ ▲ ▲ ▲ ▲             10 cards (all exposed)
```

The remaining 24 cards form the **stock**; one is flipped to start the
**waste** pile, leaving 23 in the stock.

### Coverage

A card is **exposed** (playable) only when every card that overlaps it from
the row below has been removed. The bottom row starts fully exposed. Cards are
numbered 0–27 in reading order; the fixed `COVERED_BY` table records, for each
card, which lower cards block it:

- Within each peak (rows 0→1→2): the two children directly beneath.
- Row 2 → Row 3: card `k` in row 2 is covered by bottom cards `k` and `k+1`.

`isExposed(id)` returns true when all of a card's `COVERED_BY` slots are empty.

## Mechanics

- **Playing a card.** An exposed tableau card whose rank is adjacent (±1, with
  A–K wrap) to the current waste card is moved onto the waste and becomes the
  new top. This can chain: each play may expose new cards to play next.
- **Drawing.** Clicking the stock flips its top card to the waste with no rank
  restriction. Drawing **resets the streak**.
- **Winning.** Remove all 28 tableau cards.
- **Getting stuck.** When no exposed tableau card is playable and the stock is
  empty, the game is lost.

## Scoring

- Playing tableau cards without drawing builds a **streak**. The *n*-th card in
  a run scores *n* points (1, 2, 3, …), rewarding long chains. Drawing from the
  stock resets the streak to zero.
- Clearing an entire game awards a **+20 win bonus**.
- The best score is persisted in `localStorage` under `tripeaks-best`.

## Controls

- **Click** an exposed, playable tableau card to play it.
- **Click the stock** pile (bottom-left) to flip a new card to the waste.
- **N** — new game.
- **Space** / **Start** button — deal a new game from the title screen.

## Architecture

Mirrors the repo's other card games (Klondike, FreeCell): a **pure rules
engine** of small functions over plain card objects, all exposed on `window`
so the Playwright suite can install exact boards with `loadState()` and drive
moves without touching pixels. Rendering and mouse handling sit on top and hold
no rules of their own.

- `Card: { rank: 1..13, suit: 'S'|'H'|'D'|'C' }` — suit is cosmetic only.
- `tableau` is a fixed array of 28 slots; a removed card becomes `null`.
- `stock` and `waste` are arrays; the waste **top** is the last element.
- Real deals shuffle with `Math.random`; tests call `loadState()` or
  `newGame(seed)` with a seeded PRNG for reproducibility.

## Assumptions

- **Suits are decorative.** TriPeaks is played on rank alone; suits are drawn
  for visual variety but never affect a move. Documented per the "pick the
  simpler interpretation" guidance.
- **Ace wraps both ways.** Ace (rank 1) is adjacent to both King (13) and Two
  (2) — the standard TriPeaks "around the corner" rule.
- **A single redeal is not offered.** Once the stock is empty it stays empty;
  there is no reshuffle. This is the common casual-play ruleset and keeps the
  lose condition unambiguous.
- **Getting stuck is a loss, not a soft pause.** If no move exists and the
  stock is empty, the game ends as lost rather than waiting.
- The waste pile starts with exactly one card flipped from the stock.
