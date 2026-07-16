# Video Poker (Jacks or Better) — Design

## Game concept

Video Poker is the classic single-player casino machine game. The player is
dealt five cards from a standard 52-card deck, chooses which cards to **hold**,
then **draws** to replace the rest. The resulting five-card poker hand is scored
against a fixed pay table — the familiar *Jacks or Better* variant, where the
smallest paying hand is a pair of Jacks. Winning hands pay out credits
proportional to the bet; anything below a pair of Jacks pays nothing. The goal is
to build up as many credits as possible before running out.

## Mechanics

- **Credits & bet.** The player starts with 100 credits. Each deal costs the
  current bet (1–5 credits). A winning hand pays `payoutPerCoin × bet` credits.
- **Deal → Hold → Draw.** A round has two steps:
  1. **Deal** removes the bet from the credit balance and deals five cards.
  2. The player toggles a **hold** on any subset of the five cards.
  3. **Draw** replaces every un-held card with fresh cards from the same deck,
     then the final hand is scored and any winnings are paid.
- **Hand evaluation.** A pure `evaluateHand(cards)` function classifies the five
  cards and returns the winning category and its per-coin payout. It handles
  flushes, straights (including the low-ace *wheel* A-2-3-4-5 and the high
  ace-Broadway 10-J-Q-K-A), full houses, quads, and the *Jacks or Better*
  qualifying-pair rule.
- **Pay table** (per coin bet):

  | Hand | Pays |
  |---|---|
  | Royal Flush | 250 |
  | Straight Flush | 50 |
  | Four of a Kind | 25 |
  | Full House | 9 |
  | Flush | 6 |
  | Straight | 4 |
  | Three of a Kind | 3 |
  | Two Pair | 2 |
  | Jacks or Better | 1 |
  | (anything less) | 0 |

- **Best.** The highest credit balance ever reached is persisted to
  `localStorage` under `videopoker-best` and shown in the HUD.
- **Game over.** When the balance can no longer cover a one-credit bet, the game
  ends with a game-over overlay; starting again resets to 100 credits.
- **States.** `idle` (start overlay) → `holding` (cards dealt, choosing holds) →
  `result` (hand drawn and scored) → back to `holding` on the next deal, or
  `over` when out of credits.

## Controls

| Input | Action |
|---|---|
| Space / Enter | Deal, then Draw, then Deal the next hand |
| 1 – 5 | Toggle hold on the matching card |
| Click a card | Toggle its hold |
| B | Raise the bet (cycles 1 → 5 → 1) |
| Deal / Draw button | Same as Space |

## Rendering

A single 640×420 canvas drawn entirely with canvas primitives — rounded card
rectangles with rank/suit pips, red/black suits, HELD banners, and a pay-table
panel — so the game runs straight from `index.html` with no build step, image
assets or network access.

## Testing approach (TDD)

Following the other games in this repo, the game is a single classic
(non-module) script exposing its state and logic as plain globals so the
Playwright tests can read and drive it directly. The tests were written first.

The heart of the game — `evaluateHand(cards)` — is a **pure, fully deterministic
function**, so the bulk of the suite constructs exact five-card hands and asserts
the classification and payout for every category (royal flush down to a busted
hand, plus both ace-straight edge cases and the Jacks-or-Better boundary). The
round flow is tested by seeding `hand`, `held` and the remaining `deck` directly,
then calling `deal()` / `draw()` — no randomness or wall-clock timing is involved,
so the tests can never be flaky.

Coverage: initial state, dealing (bet deducted, five cards), holding toggles,
drawing (un-held cards replaced, winnings paid, state transitions), the full pay
table via `evaluateHand`, bet changes, best-score persistence, and game over when
credits are exhausted.

## Assumptions

- **Folder name.** Uses `VideoPoker/` (PascalCase) to match existing folders; the
  git branch is the kebab-case `video-poker` as requested.
- **Simplicity over fidelity.** No sprite art, sound, or animated dealing — the
  simpler interpretation. Cards are drawn with canvas primitives.
- **Linear royal payout.** The royal flush pays a flat 250 per coin at every bet
  level, rather than the casino convention of a 4000-credit jackpot only at the
  5-coin max bet. The simpler, uniform rule is used and noted here.
- **Starting bank / bet.** 100 starting credits and a default bet of 1 (max 5),
  chosen as round, conventional defaults.
- **Best key.** `localStorage['videopoker-best']`, consistent with the
  `snake-best` / `dino-best` keys used elsewhere; it tracks the highest balance
  ever reached.
