# Feast of Booths — design

## Concept

A pencil-and-paper style logic puzzle dressed in the Feast of Booths
(Leviticus 23:40-43), when Israel lived in shelters of palm branches for seven
days. The grid is a stretch of camp ground; the palms are already standing, and
the player works out where each family's booth must be pitched.

The rules are the "tents and trees" family of logic puzzle. Nothing in the
repo uses that ruleset — the nearest neighbours are Hitori (shading under row
and column constraints) and Nonogram (edge clues) — so it adds a genuinely new
kind of deduction rather than a reskin.

## Mechanics

A camp is a square grid holding:

- **palms** — fixed, one per booth;
- **booths** — what the player places;
- **clues** — the booth count for every row and every column.

A camp is complete when all four conditions hold:

1. the booth count of every row and column equals its clue;
2. no two booths are adjacent, including diagonally;
3. no booth stands on a palm, and every booth is orthogonally beside one;
4. booths and palms can be paired off one-to-one, each booth with a palm beside
   it.

Condition 4 is the interesting one. Counting booths beside palms is not enough:
two booths can both sit beside the same palm while another palm goes without.
Pairing them off is a bipartite matching problem, so `maxMatching()` runs
Kuhn's algorithm (augmenting paths) over "booth → palms beside it" and the camp
is complete only when the matching covers every palm.

## Code tour

`game.js` is one classic (non-module) script, like the other puzzle games here,
so its pure functions and board state are plain globals the Playwright suite can
reach through `page.evaluate`.

### Pure rules

| Function | Purpose |
|---|---|
| `neighbours4` / `neighbours8` | In-bounds neighbours of a square |
| `boothCounts(grid)` | Booths per row and per column |
| `touchingBooths(grid)` | Keys of every booth touching another |
| `maxMatching(trees, booths)` | Booths that can be paired off with palms |
| `clueTrouble(p, grid)` | Rows and columns already holding too many booths |
| `violations(p, grid)` | Booths to ring in red (touching / on a palm / stranded) |
| `isSolved(p, grid)` | All four conditions above |

They take their grids as arguments rather than reading the board, which is what
makes them testable in isolation.

### Solver

`countSolutions(trees, rowClue, colClue, limit)` counts answers, stopping once
it has found `limit` of them. It walks the grid one row at a time:

- only squares orthogonally beside a palm can ever hold a booth, which cuts the
  search space hard before it starts;
- for each row it enumerates the sets of candidate squares of exactly the size
  the row clue asks for, rejecting any that touch each other or a booth in the
  row above;
- a `capacity` table (how many booths each column could still take in the rows
  below) prunes a branch as soon as a column can no longer reach its clue;
- when the last row is placed it checks the palms can all be paired off.

### Generator

`generatePuzzle(level, seed)` seeds `mulberry32` from the level and seed, then:

1. `scatterPairs` walks the squares in a shuffled order, and for each one that
   touches no existing booth it pitches a booth there and plants that booth's
   palm on a free square beside it, until the level's quota is filled;
2. the row and column clues are read straight off the scattered booths;
3. `countSolutions(..., 2)` must return exactly 1 — otherwise the scatter is
   thrown away and the loop tries again.

Because the whole thing is driven by one seeded generator, the same level and
seed always rebuild the same camp. That is what lets the suite assert that
generated camps have a unique answer, that palms never sit where booths go, and
that each level has the size and booth count it claims. In practice a unique
camp is found on the first or second scatter and the whole generation takes a
few milliseconds, so "New Camp" is instant.

### Rendering and input

`render()` repaints everything: alternating sand squares, sand dots for ruled-out
squares, palms (a leaning trunk under five curved fronds), booths (a thatched
roof on two posts — deliberately gold rather than green so it reads differently
from a palm at a glance), red rings on offending booths, and the clue strips
along the left and top, coloured green when a count is met and red when it is
exceeded. The canvas is a fixed 460×460 and `cellSize` is derived from the level
size, so all three camps share one layout.

Input is a click handler that cycles a square `ground → booth → sand → ground`,
plus a `contextmenu` handler that cycles it the other way and suppresses the
browser menu. Palm squares are never marked, and once the camp is complete the
board is frozen.

## Assumptions

Made while building this without anyone to ask, and recorded here as the brief
asked:

- **Branch.** The brief asked for a branch named after the game
  (`feast-of-booths`). The session's standing instruction is to develop and push
  on its designated branch, so the work lives there instead; the branch name is
  the only thing that changed.
- **Difficulty.** "Polished" was read as three fixed camp sizes rather than a
  free size picker — fewer controls, and each size can be tuned to a booth count
  that generates quickly and solves comfortably.
- **Uniqueness, not logical solvability.** Camps are checked to have exactly one
  answer. That is the standard bar for this puzzle family, and it is what makes
  a camp reasonable rather than a coin flip; proving a camp is solvable by a
  specific set of human deduction rules would be a much larger piece of work for
  little gain at these sizes.
- **Hints assist, they do not solve.** A hint pitches one correct booth and
  sweeps the squares around it to sand. It is deliberately the simplest useful
  help; there is no "solve the camp" button.
- **Sand marks are the player's own notes.** They are never required, never
  checked, and do not affect whether the camp counts as complete.
- **No persistence.** No high score, no saved progress, no `localStorage` — the
  other puzzle games here do not keep state either, and a camp is a few minutes'
  work.
