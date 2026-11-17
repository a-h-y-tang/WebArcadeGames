# Hearts — design notes

## Game concept

Four-handed Hearts against three computer players, on an HTML5 canvas with
plain JavaScript — no build step, no dependencies. Hearts is a *trick-avoiding*
game: every heart costs a point, the queen of spades costs thirteen, and the
player with the **fewest** points when somebody reaches 100 wins.

The collection already has eight patience games and two dice games, but no
trick-taking card game — this fills that gap. As a classic card game whose
rules are the point, it stays unthemed, which the repository's content policy
allows. There are no stakes of any kind: Hearts is scored on paper, and nothing
is wagered.

## Rules implemented

- A standard 52-card deck, dealt 13 each to four players.
- **Passing.** Before each hand every player passes three cards: left on the
  first hand, right on the second, across on the third, and the fourth hand is
  played as dealt. Then the cycle repeats.
- **The lead.** Whoever holds the two of clubs leads it to the first trick.
- **Following.** You must follow the suit led if you can; otherwise anything
  goes, subject to the two rules below.
- **No blood on the first trick.** No heart and no queen of spades may be
  played to the first trick, unless a player holds nothing else.
- **Hearts must be broken.** Hearts may not be *led* until a heart has been
  played to an earlier trick, unless the leader holds nothing but hearts. The
  queen of spades may be led at any time.
- **Winning a trick.** Highest card of the suit led takes it, and leads next.
- **Scoring.** Each heart is 1 point, the queen of spades is 13 — 26 in a hand.
  Take all 26 and you have **shot the moon**: the other three players take 26
  points each instead.
- **The game** ends when any player reaches 100 points. Lowest score wins; the
  tie-break is a shared win, which is the normal house rule.

## Code shape

The rules are pure functions over plain data, and the canvas layer holds no
rules of its own — the same split the other games in this repository use, and
what makes the Playwright suite able to set an exact deal and drive it.

```js
card   = { rank: 2..14, suit: 'S' | 'H' | 'D' | 'C' }   // 14 is the ace
hands  = [[...], [...], [...], [...]]   // 0 = you (South), then clockwise
trick  = [{ player, card }, ...]        // in the order played
taken  = [[...], ...]                   // cards each player has won this hand
scores = [0, 0, 0, 0]                   // running game score
```

Players are indexed clockwise from you: **0 South (you), 1 West, 2 North,
3 East**, so "pass left" is `(i + 1) % 4` and play simply moves to the next
index. Cards are written in tests as two characters — `QS`, `TH`, `2C` — and
`parseCard()` / `cardName()` convert both ways.

The key rules functions:

| Function | What it answers |
|---|---|
| `legalPlays(player)` | Which cards that player may legally play right now |
| `trickWinner(trick)` | Which player takes the trick on the table |
| `passDirection(handNumber)` | `'left'`, `'right'`, `'across'` or `'none'` |
| `scoreHand(taken)` | The four hand scores, moon included |
| `pointsOf(card)` | 1 for a heart, 13 for the queen of spades, else 0 |

## The computer players

A documented heuristic rather than a search — Hearts is a game of hidden
information, so a deep search over unknown hands would be false precision.

**Passing.** Pass the queen of spades unless it is well guarded (four or more
spades); pass the ace and king of spades; otherwise pass the highest cards,
preferring to void a short non-heart suit.

**Leading.** Lead the lowest card of the shortest safe suit, to get out of the
lead cheaply. Avoid leading spades while the queen is still out and the player
holds a higher spade. Hearts are led only when nothing else is allowed.

**Following.** If a lower card of the suit led is available, play the highest
card that still loses the trick — shedding big cards without taking points.
Otherwise, if the trick is cheap and the player is out of options, win it as
cheaply as possible.

**Discarding (void in the suit led).** Throw the queen of spades first, then
the ace or king of spades, then the highest heart, then the highest card.

None of the computer players look at anyone else's cards.

## Controls

| Input | Action |
|---|---|
| Click three cards, then **Pass** | Pass at the start of a hand |
| Click a card again | Take it back out of the pass |
| Click a card | Play it (illegal cards do not respond) |
| `Space` | Start, confirm a pass of three, or carry on to the next hand |
| `R` | New game |

## Files

| File | Contents |
|---|---|
| `index.html` | Canvas, HUD, overlays, pass button |
| `style.css` | Layout and theme |
| `game.js` | Rules, computer players, rendering, input |
| `tests/hearts.spec.js` | Playwright suite (written first) |

## Assumptions

Decisions taken without asking, as the task requires them to be recorded:

1. **Hearts break on a heart being played**, not on the queen of spades. The
   queen may be led at any time. This is the most common house rule.
2. **Shooting the moon gives the other three 26 points each**, rather than
   offering the shooter a choice of −26. One rule, no prompt.
3. **The game ends at 100 points** and the lowest score wins; if two players
   tie for lowest they share the win.
4. **No "jack of diamonds" variant**, no passing of fewer than three cards, no
   doubling, and no scoring options screen. One ruleset, learnable from the
   hint line.
5. **The computer players are heuristic**, as described above, with no card
   counting beyond which cards have already been played in the current hand.
   They are a fair club-level opponent, not an expert.
6. **Tricks are collected after a short pause** so a human can see what was
   played; the pause is the game's only timing element.
7. Geometry is fixed at 760×600 with 62×88 cards, scaled by CSS on small
   screens, matching the other card games in this repository.
