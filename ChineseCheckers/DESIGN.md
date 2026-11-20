# Chinese Checkers — design notes

A classic two-player Chinese Checkers (Sternhalma) board game on an HTML5
canvas: you play the ten green pegs in the southern point of the star and race
them across to the northern point, while the computer brings its ten amber pegs
the other way. No build step, no dependencies — `index.html`, `style.css`,
`game.js`.

## Game concept

The board is a six-pointed star of 121 holes. Two of the six points are used:

- **South** (bottom point) — the player's ten green pegs, target: the north point.
- **North** (top point) — the computer's ten amber pegs, target: the south point.

Pegs are never captured. The whole game is about threading a path through the
other side's pegs: a peg standing next to yours is a stepping stone, and a long
chain of jumps can carry a peg from one end of the star to the other in a single
turn. First side to fill the opposite point wins.

## The board model

The star sits on a triangular lattice. Every hole has a row `r` (0–16 from the
top) and a half-column `u`, so that neighbouring holes in the same row are two
`u` apart and the rows interleave:

| rows | holes per row | what they are |
|---|---|---|
| 0–3 | 1, 2, 3, 4 | north point (10 holes) |
| 4–7 | 13, 12, 11, 10 | north half of the central hexagon + the NW and NE points |
| 8 | 9 | the waist of the hexagon |
| 9–12 | 10, 11, 12, 13 | south half of the hexagon + the SW and SE points |
| 13–16 | 4, 3, 2, 1 | south point (10 holes) |

1 + 2 + 3 + 4 + 13 + 12 + 11 + 10 + 9 + 10 + 11 + 12 + 13 + 4 + 3 + 2 + 1 = **121**.

Screen position is `x = cx + u * step / 2`, `y = cy + (r - 8) * step * √3 / 2`,
which is what makes the lattice equilateral; the NW/NE/SW/SE points come out of
the same formula without special-casing, and the four unused points stay on the
board as empty holes to travel through.

The six lattice directions are the `(dr, du)` pairs
`(0, ±2)`, `(−1, ±1)`, `(+1, ±1)`. A **step** is one of those; a **jump** is
twice one of those, legal when the hole in between is occupied and the landing
hole is empty. Jumps chain: after landing you may jump again (and only jump —
you may not finish a chain with a step), and you may stop whenever you like.
Chains may not revisit a hole already visited in the same turn, which is what
stops a peg from bouncing between two pegs forever.

## Rules implemented

- A turn is either one step, or a chain of one or more jumps, with one peg.
- Pegs are never removed from the board.
- **Winning:** all ten of your pegs stand in the opposite point. A side also
  wins with nine pegs there when the point is completely full, the tenth being
  locked out by a peg parked in its own home — the standard answer to that way
  of blocking the other side forever.
- There is no stalemate: a step into an adjacent empty hole is always available
  somewhere on a 121-hole board holding 20 pegs.

## The computer player

The computer scores every legal move it has (all steps and all jump chains for
all ten of its pegs) and plays the best one. The score of a position is

```
progress   = Σ over its pegs of (how far down the board the peg has come)
spread     = small penalty for pegs straying sideways from the centre line
homebonus  = bonus per peg already in the target point, bigger for the deep holes
```

A move's value is the change in that score, so a five-link jump chain beats a
one-hole step unless the step tidies up a straggler. "Keen" looks one move ahead
for the player's best reply and subtracts a share of it, so it is reluctant to
build a ladder the player can use; "Gentle" ignores the reply and randomises
between moves of nearly equal value. Ties are broken with a seeded PRNG
(`Math.random` is not used), so a test can fix `rngSeed` and get the same game
twice.

## Controls

| Input | Action |
|---|---|
| Click a peg | select it; legal destinations are ringed |
| Click a ringed hole | move there (part-way through a chain, jump again) |
| Click the selected peg again | deselect / end a jump chain |
| Arrow keys | move the keyboard cursor to the nearest hole in that direction |
| Space / Enter | select the peg under the cursor, or move to the cursor |
| Esc | deselect, or end a jump chain |
| `N` | new game |
| `U` | undo your last turn (and the computer's reply) |
| Buttons | New Game, Undo, Gentle/Keen difficulty |

## Code layout

`game.js` is one plain script with globals, like the other games here, so the
Playwright suite can reach the rules directly:

- **Board** — `HOLES` (121 entries with `id`, `r`, `u`, `x`, `y`, `zone`),
  `holeAt(r, u)`, `NEIGHBOURS[id][dir]`, `JUMPS[id][dir]`.
- **State** — `board` (hole id → `null | 'player' | 'cpu'`), `turn`,
  `selected`, `chain`, `history`, `winner`.
- **Rules** (pure, no drawing) — `legalDestinations(id)`, `jumpTargets(id)`,
  `movePeg(from, to)`, `pegsHome(side)`, `checkWinner()`.
- **Computer** — `allMoves(side)`, `scorePosition(side)`, `chooseMove(side)`.
- **View** — `draw()`, `holeAtPoint(x, y)`, `holeCentre(id)` (tests use this to
  turn a hole id into a click position), plus the HUD and status line.

## Testing

`tests/chinese-checkers.spec.js` drives the real page with Playwright. The board
model is asserted directly (121 holes, the row counts above, symmetry of the
points, adjacency and jump geometry), the rules are driven through clicks on the
canvas via `holeCentre`, and whole games are played out by seeding the board
with `setupPosition()` so that wins, blocked wins and jump chains can be reached
in a handful of moves instead of a hundred. Every test also fails on any
uncaught page error or console error.

## Assumptions

- **Two players, not three or six.** The classic board seats up to six. Two
  players using opposite points is the simplest complete game and the only one
  that needs no choice of seating, so that is what is built. The other four
  points are drawn as empty holes and are legal to travel through.
- **The player always moves first**, playing the green pegs from the south
  point. Green goes "up" the board, which matches the way the board is drawn.
- **A jump chain may not include a step.** Once a peg has jumped, that turn is
  jumps only — the universal rule, and it keeps `movePeg` a single code path.
- **No "must jump if you can"** rule: a one-hole step is always allowed.
- **A peg may re-enter its own starting point.** Rather than forbid it, the
  blocked-win rule above decides the game if someone squats, which is less
  surprising than silently refusing a legal-looking move.
- **Short jumps only.** A peg hops over an *adjacent* peg into the hole directly
  beyond. The "super jump" variant, where a peg flies over a distant peg along a
  line and lands the same distance past it, is a different game and is not used.
- **No multi-level search in the computer player.** One ply, plus an optional
  look at the best reply on "Keen". A deeper search on a board with hundreds of
  legal moves per turn would stall the page, and one ply already plays a brisk,
  sensible race.
- **Unthemed.** `CLAUDE.md` asks for a Christian theme wherever a game can
  sensibly take one and allows classic board games to stay unthemed; a race of
  coloured pegs across a star gains nothing but decoration from a story, so it
  is left as the classic game, in the company of Checkers, Reversi and Gomoku.
- **Branch name.** The remote only accepts the branch this session was given
  (`claude/compassionate-ramanujan-9o1yrq`), so the work lives there rather than
  on a `chinese-checkers` branch.
