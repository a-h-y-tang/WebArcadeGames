# Blackjack

The casino classic (21) built with HTML5 Canvas — the arcade's first card game.
Beat the dealer's hand without going over 21.

## How to Play

Open `index.html` in any modern browser — no build step, no dependencies.

| Input | Action |
|---|---|
| Deal button / D / Enter / Space | Deal the next round |
| Hit button / H | Draw another card |
| Stand button / S | Hold and let the dealer play |
| + / − buttons or ↑ / ↓ | Raise / lower your bet |

**Objective:** Get a hand total closer to **21** than the dealer without busting
(going over 21). Face cards are worth 10; an Ace is 11 or 1, whichever helps.

**Rules:**
- The dealer reveals their hole card after you stand and **draws until 17+**.
- A two-card **21 is a blackjack** and pays **3:2**.
- Ties are a **push** — your bet comes back.
- Win even money, lose your bet, or push — your chip balance tracks it all.
- Run out of chips and the next deal grants a fresh 100-chip re-buy.

Your best balance is saved in `localStorage` and persists between sessions.

## Design

See [DESIGN.md](DESIGN.md) for the concept, ace-aware hand valuation, the round
state machine, payout table, and rendering details.

## Tests

Playwright specs live in [`tests/blackjack.spec.js`](tests/blackjack.spec.js).
From the repo root:

```bash
npx playwright test Blackjack/tests/
```
