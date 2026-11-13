# Dominoes — design

## Concept

Classic **draw dominoes** (also called "block and draw") for one player against
the computer, on a plain HTML5 canvas. A double-six set of 28 bones is shuffled,
both players take seven, and the rest becomes the boneyard. Players take turns
adding a bone to either open end of the train; a player who cannot go draws from
the boneyard, and passes only when the boneyard is empty. Emptying your hand
("domino!") wins the hand and scores the pips left in the opponent's hand. First
to 100 points wins the game.

Nothing in the repository plays like this. The nearest neighbours are the
falling-block games (Columns, Pill Drop, Blob Drop) and the tile-laying race in
Living Water, none of which use a matching-ends bone train, hand management or a
boneyard. It also fills out the thinnest category in the game browser —
Cards & Dice had eight games out of about a hundred and fifty.

## Content policy

Checked against `CLAUDE.md`. Dominoes is a traditional family tile game: there
are no stakes, no wagering, no chips and no money — the score is plain points,
exactly as in the repo's Yahtzee, Farkle and Darts. Nothing about alcohol, the
occult, or anything crude or suggestive. `CLAUDE.md` says that "classic board
and card games ... can stay unthemed when a theme would only be decoration", so
this game keeps the traditional ivory-and-ebony look rather than wearing a Bible
story that would not touch the rules. The title is the generic name of the game
and is not a trademarked arcade title.

## Mechanics

### The bones

A bone is a canonical pair `[a, b]` with `a <= b`. `fullSet()` builds all 28
combinations of 0–6. `pips` sums a bone, `isDouble` tests for a double.

### The train

`layout` is the train in left-to-right order. Each entry records the bone and
the way it was laid:

```js
{ tile: [2, 5], a: 5, b: 2 }   // 5 faces left, 2 faces right
```

The invariant is that `layout[i].b === layout[i + 1].a`, so the two open ends are
`layout[0].a` and `layout[last].b`. Playing a bone at the left end requires the
bone to contain `left`; it is laid with that number facing right (`b = left`) and
unshifted. The right end is the mirror image. `canPlayTile` reports which ends
accept a bone, and `playableTiles` lists the indices of the bones in a hand that
can go anywhere.

### A hand

1. **Opening.** The player holding the highest double leads with it. If neither
   holds a double, the highest-pip bone leads. The opening bone is played
   automatically, because that bone is forced.
2. **Turns** alternate. On your turn you either play a bone, or — only when you
   hold nothing playable — draw one bone from the boneyard, or — only when you
   hold nothing playable and the boneyard is empty — pass.
3. **The hand ends** when somebody plays their last bone, or when both players
   pass in a row (the train is blocked).
4. **Scoring.** The winner scores the pips left in the loser's hand. If the
   train is blocked, the smaller hand wins and scores the other hand's pips;
   equal hands score nothing.
5. **The game** ends when a score reaches 100.

### The computer

On its turn the computer plays the highest-scoring bone it can, breaking ties in
favour of doubles (doubles are the hardest bones to shed, so it gets rid of them
early). This is a simple, readable heuristic rather than a search: it plays a
sound opening game, sheds heavy bones so it loses less when blocked, and is
beatable.

## Controls

| Input | Effect |
|---|---|
| Click a bone in your hand | Selects it; if it fits only one end it is played at once |
| Click a glowing pad beside the train | Plays the selected bone at that end |
| `←` / `→` | Move the selection along your hand |
| `Enter` | Play the selected bone (right end if both ends fit) |
| `L` / `R` | Play the selected bone at the left / right end |
| `D` | Draw from the boneyard |
| `P` | Pass |
| Draw / Pass buttons | Same as `D` / `P`; they enable only when the rules allow |
| New Game button | Reshuffles and starts the match at 0–0 |

Illegal moves are refused and explained in the message line rather than silently
ignored.

## Code tour

`game.js` is one classic (non-module) script, like the other games here, so its
pure functions and its state are plain globals the Playwright suite reaches
through `page.evaluate`.

### Pure rules

| Function | Purpose |
|---|---|
| `fullSet()` | The 28 bones of a double-six set |
| `pips(tile)` / `isDouble(tile)` | Pip total / double test |
| `openEnds(layout)` | `{ left, right }`, or `null` for an empty train |
| `canPlayTile(tile, layout)` | `{ left, right }` booleans |
| `playableTiles(hand, layout)` | Indices of the bones that can be played |
| `handPips(hand)` | Pips left in a hand |
| `openingMove(hands)` | Who leads, and with which bone |
| `bestMove(hand, layout)` | The computer's choice |
| `trainGeometry(layout)` | Canvas rectangles for the train and the two end pads |
| `handGeometry(hand)` | Canvas rectangles for the bones in your hand |

They all take their arguments rather than reading the globals, which is what
makes them testable on their own.

### State

`hands` (`[you, computer]`), `boneyard`, `layout`, `turn`, `scores`, `passes`,
`phase` (`playing` / `hand-over` / `game-over`), `selected` and `message`.
`newGame(seed)` reseeds a mulberry32 PRNG and deals, so a given seed always
deals the same bones; `setupHand({ you, computer, boneyard, layout, turn })` is a
test and debugging hook that drops the game into an exact position.

### Drawing

`render()` repaints everything from state: the computer's bones face down along
the top, the train, and your hand. The train is laid left to right and wraps to
the next row when a bone would not fit; doubles are drawn across the train, as
they are on a table. Each row is centred across the cloth and the rows in use
are centred top to bottom, so a short train sits in the middle of the table
rather than in a corner, and the two end pads — which carry the number you have
to match — sit in the gutter each row reserves for them. Bones in your hand that
cannot be played are dimmed, and the selected one is lifted and outlined.

## Assumptions

Decisions taken without asking, following "pick the simpler interpretation":

1. **Branch name.** The task asks for a branch named after the game, while this
   session may only push to `claude/compassionate-ramanujan-b829be`. The work was
   written on a local `dominoes` branch and pushed to the permitted remote
   branch.
2. **Two players.** Dominoes is often played by three or four, in teams. One
   human against one computer keeps the hand and the scoring simple.
3. **The train is a straight line that wraps into rows.** Real tables snake the
   train around corners, and spinners (doubles) can sprout side trains. Here the
   train has exactly two open ends and wraps like text when it reaches the edge
   of the canvas.
4. **The same opening rule for every hand.** Highest double leads each hand,
   rather than the winner of the previous hand leading. One rule, always true,
   and the opening bone is forced so nothing is taken away from the player.
5. **Draw one bone at a time.** Some rule sets make you keep drawing until you
   can play. Drawing one bone per click shows the player what arrived.
6. **Scoring is the loser's pips**, not a rounded-to-five count and not the
   difference between the hands, and the target is 100 points.
7. **No spinner rule, no "must play a double when you can"**, and no timer.
