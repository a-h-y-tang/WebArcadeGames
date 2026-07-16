# Video Poker

A *Jacks or Better* video-poker machine built with HTML5 Canvas — deal, hold,
draw, and get paid for your poker hands.

## How to Play

Open `index.html` in any modern browser — no build step, no dependencies.

| Input | Action |
|---|---|
| Space / Enter | Deal, then Draw, then Deal the next hand |
| 1 – 5 | Toggle hold on the matching card |
| Click a card | Toggle its hold |
| B | Raise the bet (1 → 5 → 1) |
| Deal / Draw button | Same as Space |

**How a round works:** Press **Deal** to pay your bet and get five cards. Click or
press **1–5** to keep the cards you like, then press **Draw** to replace the rest.
Your final five-card hand is scored against the pay table.

## Pay Table (per coin bet)

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

Anything below a pair of Jacks pays nothing. Winnings are multiplied by your bet.
Run out of credits and it's game over — your best balance is saved in
`localStorage` and persists between sessions.
