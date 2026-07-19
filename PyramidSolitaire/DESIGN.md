# Pyramid Solitaire — Design

## Concept

The classic **Pyramid** patience game. Twenty-eight cards are dealt face-up
in a seven-row pyramid, each card half-covering two cards in the row below.
Your job is to clear the whole pyramid by removing cards in **pairs that add
up to 13**. Kings are worth 13 and are removed on their own.

Card values: Ace = 1, 2–10 = face value, Jack = 11, Queen = 12, King = 13.
So the matching pairs are:

```
A + Q     2 + J     3 + 10     4 + 9     5 + 8     6 + 7     K (alone)
```

A card can be removed only while it is **exposed** — nothing overlaps it
from below. The bottom row starts fully exposed; removing both cards that
cover a card exposes it in turn.

The 24 cards not in the pyramid form the **stock**. Click the stock to flip
its top card to the **waste**; the top of the waste is always available to
pair with an exposed pyramid card (or with the card beneath it in the waste,
by selecting the waste top twice in succession is not allowed — see rules).
When the stock runs out, clicking it recycles the waste back into the stock
so you can go through it again.

## Mechanics

- **Deal.** A shuffled 52-card deck fills the pyramid (28 cards, rows 1–7)
  top-to-bottom, left-to-right; the remaining 24 become the stock. The
  shuffle is driven by a small seeded PRNG so real play is varied but any
  given seed reproduces exactly the same deal — which is what makes the
  logic testable.
- **Exposed test.** A pyramid card at row *r*, column *c* is exposed when
  the two cards that overlap it — (r+1, c) and (r+1, c+1) — have both been
  removed. Bottom-row cards have no coverers and are exposed from the start.
- **Selecting & removing.**
  - Clicking an exposed card **selects** it (click again to deselect).
  - A **King** (value 13) is removed immediately on click — no partner
    needed.
  - Clicking a second exposed card whose value plus the selected card's
    value is **13** removes both.
  - The **waste top** counts as an exposed card and can be part of a pair.
  - Clicking a covered/unavailable card does nothing.
- **Stock / waste.** Clicking the stock moves its top card to the waste.
  When the stock is empty, clicking it recycles the waste back (unlimited
  passes — see Assumptions).
- **Winning.** Clear all 28 pyramid cards and you win. The stock and waste
  do not need to be emptied.
- **Scoring.** +5 for each pyramid card removed, plus a +100 bonus for
  clearing the pyramid. The best score is persisted to `localStorage`
  under `pyramid-best`.

## Controls

Mouse / touch driven:

| Input | Action |
|---|---|
| Click an exposed pyramid card | Select it / remove a King |
| Click a matching exposed card | Remove the pair (sums to 13) |
| Click the stock pile | Deal the next card to the waste (or recycle) |
| Click the waste top | Select it as one half of a pair |
| `N` key / New Game button | Deal a fresh pyramid |

## Architecture

Single non-module `game.js` so all state and logic are reachable from the
Playwright tests as plain globals, matching the repo's existing games. The
game is **turn-based**, so there is no animation loop to reason about —
rules are expressed as pure functions over the global card arrays and the
canvas is redrawn after each action.

Key globals exposed for tests: `state`, `pyramid` (a 7-row jagged array of
card objects), `stock`, `waste`, `selected`, `score`, `best`, and the pure
helpers `cardValue`, `isExposed`, `newGame(seed)`, `clickPyramid(r, c)`,
`clickStock()`, `clickWaste()`, `remaining()`. A seeded deal via
`newGame(seed)` gives tests a known, reproducible board.

## Assumptions

- **Unlimited stock recycles.** The traditional game limits you to a fixed
  number of passes through the stock (often three). Per the task's "pick the
  simpler interpretation" guidance, recycling is unlimited here — it keeps
  the state machine simple and the game approachable, at the cost of some
  difficulty. Noted as a deliberate simplification.
- **Waste-with-waste pairing is not modelled.** Only the single top waste
  card is available; you cannot pair two waste cards together. The exposed
  pyramid cards plus the one waste top are the playable set. This keeps the
  "exposed set" easy to reason about and to test.
- **No explicit lose state.** Because recycling is unlimited there is always
  a legal stock click, so the game never hard-locks; a stuck board is simply
  one the player abandons via New Game. A "no pair-moves available" check is
  exposed for a possible hint but is not a game-over trigger.
- **Seeded, deterministic deals.** The shuffle uses a seeded PRNG rather than
  `Math.random` for the deal so tests are reproducible; a fresh real game
  seeds from the clock for variety.
