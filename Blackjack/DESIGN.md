# Blackjack — Design Document

## Game Concept

**Blackjack** (21) is the classic casino card game rendered on an HTML5 canvas
felt table. The player is dealt two cards and tries to get a hand total closer
to **21** than the dealer without going over. It is the first *card* game in the
arcade — a deliberately different genre from the reflex, puzzle, and board games
already in the repo.

The player has a chip **balance** and places a **bet** each round. Winning pays
even money, a natural **blackjack pays 3:2**, and a tie is a **push** (bet
returned). The all-time best balance is tracked and persisted.

## Mechanics

### Card values
- Number cards are worth their pip value; **J/Q/K = 10**; **Ace = 11 or 1**.
- Aces are counted as 11, then demoted to 1 one at a time while the hand would
  otherwise bust. `handValue([A, 9, 9]) === 19`; `handValue([A, A]) === 12`.

### Round flow (`state` machine)
```
betting ──deal──► playerTurn ──stand──► dealerTurn ──► roundOver ──deal──► …
                       └──bust────────────────────────► roundOver
        (natural blackjack on the deal jumps straight to roundOver)
```
- **betting** — adjust the bet, then deal.
- **playerTurn** — **hit** to draw, or **stand** to hold.
- **dealerTurn** — dealer reveals the hole card and **draws to 17 or more**
  (stands on all 17s, hard or soft). Resolved synchronously.
- **roundOver** — the result is settled against the balance; deal again.

### Outcomes & payouts (bet `b`)
| Result | Condition | Balance change |
|---|---|---|
| `blackjack` | player natural 21, dealer not | `+floor(1.5·b)` |
| `win` | player > dealer, or dealer busts | `+b` |
| `push` | equal totals (or both natural) | `0` |
| `lose` | player busts, or dealer > player | `−b` |

### Betting
Bet moves in steps of 5, clamped to `[5, balance]`. If the balance ever falls
below the minimum bet, the next deal grants a friendly re-buy back to 100 chips
so the game is always playable.

## Controls

| Input | Action |
|---|---|
| Deal button / **D** / **Enter** / **Space** | Deal (start next round) |
| Hit button / **H** | Draw a card |
| Stand button / **S** | Hold and let the dealer play |
| **+ / −** buttons, **↑ / ↓** | Raise / lower the bet |

## Architecture

A single static page — `index.html`, `style.css`, `game.js` — with no build
step, matching every other game in the repo. All game state and the core
functions (`deal`, `hit`, `stand`, `handValue`) live at module scope so the
Playwright suite can drive the game **deterministically** by assigning `deck`,
`playerHand`, and `dealerHand` and then calling a function — no timers, no
randomness in the tests.

### Deck & draw order
`shuffledDeck()` builds a 52-card deck and Fisher–Yates shuffles it. `drawCard()`
draws from the **end** of the array (`pop`), reshuffling a fresh deck only when
the deck runs empty. Because draws come off the end, a test can lay out exactly
the cards it wants: `deal()` draws in the order *player, dealer, player, dealer*.

### Rendering
`render()` paints a radial-gradient felt table, both hands (the dealer's hole
card face-down until reveal), the running hand totals, and a result banner.
Cards are drawn as rounded rectangles with a rank/suit corner index, a mirrored
opposite corner, and a large center pip; hearts and diamonds are red.

### Persistence
`balance` and `best` are stored in `localStorage` under `blackjack-balance` and
`blackjack-best`, and reloaded on start (best is never less than the current
balance or the 100-chip starting stack).

## Assumptions

- **Dealer stands on all 17s** (including soft 17). This is the simplest and
  most common house rule; picking one rule keeps the resolution deterministic.
- **No splitting, doubling, or insurance.** These add UI and edge cases without
  changing the core game; the simpler ruleset (hit/stand/bet) was chosen
  deliberately and can be layered on later.
- **Single reshuffling deck**, not a multi-deck shoe. Card counting is irrelevant
  to a casual arcade game, so the simplest model was used.
- **Blackjack pays 3:2**, rounded down (`floor`) on odd bets — matches the felt
  and avoids fractional chips.
- **Auto re-buy** to 100 chips when broke, so the game never dead-ends (an
  arcade game should always let you play again).
