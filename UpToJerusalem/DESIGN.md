# Up to Jerusalem — design notes

*"I rejoiced with those who said to me, 'Let us go to the house of the LORD.'"* — Psalm 122:1

## Game concept

Four pilgrim families set out from four corners of the land and race up to
Jerusalem for the feast, just as Joseph and Mary "went to Jerusalem every year
at the Feast of the Passover" (Luke 2:41). Each family has four pilgrims
waiting in its home town. A roll of the die sends a pilgrim out onto the
pilgrim road, around the land, and finally up the ascent into the temple
courts. The first family to gather all four of its pilgrims in the temple wins
the feast.

Mechanically this is the classic cross-board race game (Ludo / Pachisi /
Parcheesi): a shared circular road, a private ascent for each family, entry on
a six, captures that send a pilgrim home, safe wells that cannot be raided, and
an exact roll needed to reach the temple. You play the blue family from
Nazareth; three computer families travel against you.

The repository has no race-and-capture board game of this kind. *Jacob's
Ladder* is a pure-luck ladder climb with a single token and no choices; this
game gives four tokens, a choice every turn, captures, blocking stacks and a
real decision about risk.

## Board

A 15 x 15 grid of cells drawn on a 600 x 600 canvas (40 px cells), the familiar
cross shape:

- **Shared road** — 52 cells running round the cross, indexed `0..51`
  clockwise. Four of them are family **start cells** (indices 0, 13, 26, 39)
  and four are **wells** (8 cells on from each start: 8, 21, 34, 47). Start
  cells and wells are *safe*: a pilgrim standing there cannot be sent home.
- **Home towns** — a 6 x 6 block in each corner holding that family's four
  waiting pilgrims.
- **Ascents** — a private five-cell column per family leading from the road
  into the centre.
- **The temple** — the centre of the board, where finished pilgrims rest.

Each pilgrim's position is a single number along its *own* path:

| Value | Meaning |
|---|---|
| `-1` | waiting in the home town |
| `0..51` | on the shared road; road index = `(start + s) % 52` |
| `52..56` | the family's five ascent cells |
| `57` | in the temple (finished) |

Because every family's path is numbered from its own start cell, one `stepTo`
function covers all four families, and the shared-road collision test is just a
comparison of road indices.

## Mechanics

- **Turn order** — Nazareth (you, blue), Jericho (green), Beersheba (amber),
  Joppa (rose), clockwise.
- **Leaving home** — a pilgrim only sets out on a **6**, landing on its family's
  start cell.
- **Moving** — the die value is the number of cells moved. You choose which
  pilgrim moves; only legal moves are offered.
- **The temple** — a pilgrim must land **exactly** on the temple (path 57).
  An overshoot is not a legal move, so late in the game some rolls are wasted.
- **Captures** — landing on a road cell holding a **single** opponent pilgrim
  sends that pilgrim back to its home town. Captures are impossible on a start
  cell or a well, and impossible in an ascent (those cells are private).
- **Camps** — two or more pilgrims of the same family may share a road cell.
  A camp of two or more cannot be captured. Opponents may pass over it.
- **Extra rolls** — rolling a 6 or making a capture earns another roll. Three
  sixes in a row forfeit the turn (so a run of sixes cannot stall the game).
- **No legal move** — if the roll cannot be used, the turn passes.
- **Winning** — the first family with all four pilgrims in the temple wins and
  the game ends. Games you win are kept in `localStorage`.

## Controls

| Action | Input |
|---|---|
| Start a game / roll the die | **Space**, **Enter**, or the **Roll** button |
| Move a pilgrim | **click** it on the board, or **1**–**4**, or **Enter** |
| New game | **N**, or the **New Game** button |

Movable pilgrims are ringed and their destination cell is marked with a ghost
token, so a legal move is always visible before it is made. The status line
says whose turn it is and what the last roll did.

## Code shape

`game.js` is a single plain script (no modules, no build step), matching the
other games in this repository, so Playwright tests can read and drive its
globals directly.

- **Geometry** — `ROAD` (52 road cells as `{r, c}`), `ASCENT[p]`, `TOWN[p]`
  (four waiting spots), `TEMPLE_SEATS[p]`, built once by `buildBoard()`.
- **Pure rules** — `stepTo(player, s)` (path value to a cell), `roadIndexOf`,
  `legalMoves(player, die)`, `captureTargets(move)`, `hasWon(player)`.
  These take the current state and return data; they draw nothing.
- **Turn flow** — `rollDie()` → `legalMoves()` → `applyMove()` → `endTurn()`.
  `applyMove` performs the capture, the extra-roll bookkeeping and the win
  check, then `draw()` renders.
- **Computer play** — `bestMove(player, moves)` scores each legal move:
  reaching the temple > capturing > escaping a threatened cell > setting out
  from home > landing on a well > plain progress. It is deliberately a simple
  heuristic: readable, fast, and good enough to put up a fight.
- **Rendering** — one `draw()` paints the board, the towns, the ascents, the
  temple, every pilgrim and the highlights. No partial redraws.

### Test hooks

So the tests are deterministic and fast, `game.js` exposes two globals:

- `diceQueue` — an array of forced die values. `rollDie()` shifts from it when
  it is not empty and falls back to `Math.random()` otherwise.
- `aiDelay` — milliseconds the computer waits before acting (450 by default).
  Tests set it to `0`; they can also set `autoPlay = false` and drive the
  computer a step at a time with `aiStep()`.

## Assumptions

The task left several details open. The simpler reading was taken each time,
and recorded here:

1. **Four tokens, one human.** You play one family; the other three are
   computer players, matching the repository's other board games.
2. **No path blocking.** A camp of two of your own pilgrims is safe from
   capture but does *not* stop opponents passing over it. Full Pachisi
   blockades would add a rule the board cannot show clearly.
3. **Entry on a six only**, and leaving home costs the whole roll.
4. **One die**, not two. Two dice (true Pachisi) would need split moves.
5. **The game ends with the first winner.** Second and third place are not
   played out.
6. **Three consecutive sixes forfeit the turn**, the common house rule, to
   bound a turn's length.
7. **Captures grant an extra roll**, as in most published Ludo rules.
8. **Wells are the traditional eighth cell after each start.** There are four
   of them, one per family, plus the four start cells, giving eight safe cells.
9. **No scores.** A race has a winner, not a score; the only number kept is
   how many games you have won, in `localStorage`.
10. **Keyboard parity.** Everything doable with the mouse is doable from the
    keyboard, as in the newer games here.
