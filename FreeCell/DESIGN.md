# FreeCell — Design

## Concept

FreeCell is the classic open-information solitaire made famous by Windows. All
52 cards are dealt face-up into eight tableau columns. Using four **free cells**
as temporary single-card holders, the player rearranges the tableau and builds
the four **foundations** up from Ace to King, one per suit. Because nothing is
hidden and (almost) every deal is winnable, FreeCell is a game of pure planning
rather than luck.

It fills a genuine gap in this repo: the only solitaire-family game present is
Klondike, and FreeCell's mechanics — no stock/waste pile, open information, free
cells, and multi-card "supermoves" — are distinct.

## Layout

```
[free][free][free][free]        [♣][♦][♥][♠]   <- free cells / foundations
--------------------------------------------------
  col0  col1  col2  col3  col4  col5  col6  col7  <- 8 tableau columns
```

- **Tableau:** 8 columns. The deal puts 7 cards in columns 0–3 and 6 cards in
  columns 4–7 (7·4 + 6·4 = 52). Only the bottom (last-dealt) card of each column
  is directly playable, but valid descending, alternating-colour runs move
  together (a supermove).
- **Free cells:** 4 slots, each holding at most one card.
- **Foundations:** 4 piles, one per suit, built up A→K.

## Rules

- A card may move onto a tableau column if that column is **empty**, or if its
  top card is **one rank higher and the opposite colour** (e.g. a red 6 onto a
  black 7).
- A card may move to a **free cell** only if the cell is empty.
- A card may move to its **foundation** if it is the next rank up for its suit
  (Ace first, then 2, 3, … up to King).
- **Supermove:** although only one card physically moves at a time, a valid
  descending/alternating run can be moved in one action. The number of cards
  that can move at once is `(freeCells + 1) × 2^(emptyColumns)`; moving *onto* an
  empty column reduces the empty-column count by one.
- **Winning:** all 52 cards reach the foundations.

## Controls

FreeCell is mouse-driven:

- **Click** a tableau column, free cell, or foundation to select the card (or
  the longest valid run) there.
- **Click** a destination to move it. An illegal move clears the selection.
- **Double-click** any playable card to send it straight to its foundation if it
  fits.
- The **Auto** button (or pressing `A`) sweeps every card that can safely go to a
  foundation — handy for finishing a solved board.
- **New Game** deals a fresh, deterministic board.

## Scoring

There is no points score; FreeCell is won or lost. The HUD tracks **Moves** and
elapsed **Time**, and **Best** stores the fewest moves in which you have ever won
(persisted to `localStorage` under `freecell-best`).

## Implementation notes

The game is a single classic (non-module) `game.js` script so its state
(`tableau`, `free`, `found`, `moves`, `state`, …) and its rule functions
(`dealGame`, `foundationAccepts`, `tableauAccepts`, `isSequence`, `maxMove`,
`moveTableauToTableau`, `autoCollect`, `isWon`, …) are reachable as globals from
the Playwright tests — the testing seam the other games in this repo use. Rules
are implemented as small pure predicates so tests can build exact board states
and assert outcomes with no timing or RNG dependence.

Deals use the well-known Microsoft FreeCell linear-congruential shuffle keyed by
a game number, so `dealGame(n)` is fully reproducible and the same numbered deal
always produces the same board. A random game number is chosen for a normal
"New Game".

Cards are plain objects `{ rank: 1–13, suit: 'C'|'D'|'H'|'S' }`; red suits are
hearts and diamonds. The canvas renders the four zones with fanned tableau
columns and hit-tests clicks against card rectangles.

## Assumptions

Ambiguous points were resolved to the simpler option and noted here, per the task
guidance:

- **Supermove** is offered (with the standard `(free+1)·2^empty` capacity) rather
  than forcing the player to shuffle cards through free cells one at a time.
- **Auto-collect** only moves a card up when it is safe (no lower card of the
  opposite colour still needs it), plus always sends Aces and 2s.
- **Best** is measured in fewest moves; time is shown but not ranked.
- Only single-card moves to free cells / foundations; runs move only between
  tableau columns.
- The deal is deterministic per game number but the game-number picker is the
  only randomness; there is no separate difficulty setting (all standard deals).
