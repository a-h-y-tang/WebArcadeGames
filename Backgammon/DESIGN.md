# Backgammon — design notes

## Concept

Backgammon is the oldest board game still widely played: a race around a
24-point board where both sides run in opposite directions, dice decide how far
you may move, and a lone checker can be sent all the way back to the start. This
is a single-player version — you play the light checkers against a heuristic
computer opponent that plays the dark ones.

The collection already has Checkers, Hex, Quoridor, Mancala, Nine Men's Morris
and Hnefatafl, but no race game of this kind; Backgammon is the classic that was
missing. It is kept unthemed, as `CLAUDE.md` allows for classic board games
("classic board and card games ... can stay unthemed when a theme would only be
decoration") — the rules are what people come for, and renaming the points would
only get in the way of a game most players already know.

No stake, wager, score-keeping across games or doubling cube is involved: see
*Assumptions* below.

## Board model

Everything lives in one plain object, `pos`, so the AI can clone a position
cheaply:

```js
pos = {
    pts:  [ /* 24 signed integers */ ],
    barW: 0, barB: 0,   // checkers sitting on the bar
    offW: 0, offB: 0,   // checkers borne off
}
```

- `pts[i]` holds the checkers on point `i + 1`. **Positive is white** (the
  player), **negative is dark** (the computer); the magnitude is the number of
  checkers, so `pts[5] === 5` is the five white checkers on point 6 and
  `pts[0] === -2` is the two dark checkers on point 1.
- White runs **downhill** (point 24 → point 1) and bears off past point 1.
  Dark runs **uphill** (point 1 → point 24) and bears off past point 24. One
  signed array plus a direction is enough for both.
- White's home board is points 1–6 (`pts[0..5]`), dark's is points 19–24
  (`pts[18..23]`).

The opening position is the standard one — 2 on the 24-point, 5 on the 13-point,
3 on the 8-point, 5 on the 6-point for each side, mirrored — which gives both
players a pip count of 167.

## Rules implemented

| Rule | Where |
|---|---|
| Two dice, doubles give four moves | `rollDice()` |
| A checker may land on an empty point, your own point, or a point with exactly one enemy checker | `canLand()` |
| Landing on a lone enemy checker (a *blot*) sends it to the bar | `applyMoveTo()` |
| Checkers on the bar must re-enter before anything else moves | `movesForPos()` |
| Entry point is `25 − die` for white, `die` for dark | `entryTarget()` |
| A die with no legal move is forfeited; a roll with no legal move passes the turn | `pruneDice()` |
| Bearing off only once every checker is home and none is on the bar | `canBearOffPos()` |
| Exact die bears off; a larger die bears off only when no checker sits further from home | `movesForPos()` |
| First side to bear off all fifteen checkers wins | `checkWin()` |
| Gammon (opponent has borne off nothing) and backgammon (opponent still in your home board or on the bar) are named on the win screen | `winMargin()` |

`movesForPos(pos, player, pips)` is the single source of truth for legality: it
returns every `{ from, to, die }` the position allows, where `from` is a point
index or `'bar'` and `to` is a point index or `'off'`. The UI uses it to decide
what a click may do and to highlight targets, the turn logic uses it to know
when a turn is over, and the AI uses it to search. Nothing else decides whether
a move is legal.

## The computer opponent

`bestSequence()` walks the whole tree of move orders for the dice it rolled,
memoising positions it has already reached (board + dice still in hand), and
scores every leaf with `evaluate()`:

- the pip-count difference (the main term — backgammon is a race),
- checkers borne off, and enemy checkers sent to the bar,
- a penalty for leaving blots, doubled inside the enemy home board where they
  are easiest to hit,
- a bonus for made points (two or more checkers) in its own home and outer
  board, since those are what block the other side.

It then plays the winning sequence one move at a time on a timer so the moves
are watchable rather than instant. The search is deliberately one ply deep: it
plays a reasonable race and punishes loose blots, but it does not look ahead at
the opponent's reply.

Against an opponent playing legal moves at random it wins 59 games out of 60,
and sixty whole games search in about a second and a half, so the pause between
its moves is pacing rather than thinking time.

## Rendering

A single 900 × 560 canvas, redrawn each frame from `pos`:

- `MARGIN 16`, twelve `COL_W 64` columns, a `BAR_W 36` bar in the middle and a
  `TRAY_W 64` tray on the right for borne-off checkers.
- Column 0 is the left edge; points 13–24 run left to right along the top,
  points 12 down to 1 run left to right along the bottom, which is the standard
  layout with white's home board in the bottom right. The whole mapping is the
  two lines in `pointGeom()`.
- A point stacks up to five checkers; beyond that the stack stays five tall and
  the count is printed on the top checker.
- `pointAt(x, y)` is the inverse mapping used by the click handler, returning a
  point index, `'bar'`, `'off'` or `null`.

The HUD (pip counts, borne-off counts, whose turn it is, and the message line)
is plain HTML above and below the canvas, not canvas text, so tests can assert
on it directly.

## Controls

| Input | Action |
|---|---|
| **Roll** button, or `Space` / `Enter` | Roll the dice |
| Click one of your points | Pick the checker to move (legal destinations light up) |
| Click a highlighted point | Move there |
| Click the bar | Pick the checker you must re-enter |
| Click an entry point while on the bar | Enter straight away — nothing else may move anyway |
| Click the tray (right edge) | Bear off the selected checker |
| Click the same point again | Cancel the selection |
| `R` | Restart |

## Testing

`tests/backgammon.spec.js` drives the real page. Because all state is in
top-level `let` bindings, a test can set an exact position and a known dice
sequence and then assert on the outcome:

```js
await page.evaluate(() => { diceQueue = [3, 5]; rollDice(); });
```

- `diceQueue` is a queue of forced die values that `rollDice()` drains before
  falling back to `Math.random()`, which makes every dice-dependent test
  deterministic.
- `aiEnabled = false` freezes the computer so a test owns the whole board, the
  same trick the Checkers suite uses.
- The tests that do exercise the AI assert the invariants instead of exact
  moves: the turn comes back, and every side still owns fifteen checkers across
  board, bar and tray.

Tests were written before the implementation: the suite was committed red, then
`game.js` was built until it went green.

## Assumptions

- **Unthemed.** `CLAUDE.md` prefers a Christian theme "wherever a game can
  sensibly take one" and explicitly exempts classic board games. Backgammon's
  points, bar and pip count are the game; renaming them would be decoration
  over rules everybody already knows, so the board is left as the classic one.
  There is nothing to flag against the content policy: no stake of any kind is
  played for, which is the rule that matters here.
- **No doubling cube, no match play.** The cube is the part of backgammon that
  belongs to gambling, so it is left out entirely, along with any running score
  between games. Each game is a single game played for nothing.
- **"You must play both dice if you legally can" is simplified.** The real rule
  obliges you to pick a move order that uses as many dice as possible. Here a
  die is forfeited whenever no legal move exists for it at the moment it is
  played, which can occasionally let a player waste a die that a different order
  would have used. The simpler reading was chosen deliberately; the AI is
  unaffected because it searches whole sequences and scores the result.
- **One ply of AI search.** The computer evaluates its own resulting position
  only, with no reply or roll lookahead. It plays a decent race rather than a
  strong one, which suits a browser arcade game.
- **Human is always white and always moves first.** No opening roll-off; it
  only adds a click.
- **Branch name.** The task asked for a branch named after the game
  (`backgammon`). This session is restricted to pushing its assigned branch,
  `claude/compassionate-ramanujan-qjymsk`, so the work was developed and pushed
  there, as every earlier game in this repository was.
