# Tower of Hanoi — Design

## Game concept

The classic **Tower of Hanoi** puzzle on an HTML5 canvas. A stack of graduated
disks starts on the left peg; the goal is to rebuild the whole stack on the
right peg, moving one disk at a time and never placing a larger disk on a
smaller one. The puzzle is always solvable, and the minimum number of moves for
*n* disks is exactly **2ⁿ − 1** — the game shows this target and counts your
moves against it.

## Rules

- There are **three pegs** (A, B, C) and **n disks** of distinct sizes.
- Disks begin on peg **A**, largest at the bottom, smallest on top.
- A move takes the **top** disk of one peg and places it on another peg.
- A disk may only be placed on an **empty peg** or on top of a **larger** disk.
- You **win** when every disk sits on peg **C** (the target).
- The **move counter** and the **optimal count** (2ⁿ − 1) are shown; solving in
  the optimal number of moves is a perfect game.

## Controls

| Action                       | Input                                          |
|------------------------------|------------------------------------------------|
| Pick up a peg's top disk     | Click the peg                                  |
| Drop the held disk on a peg  | Click the destination peg                      |
| Cancel a selection           | Click the same peg again                       |
| Choose the number of disks   | The **3 / 4 / 5 / 6** buttons                  |
| Auto-solve (demo)            | The **Solve** button                           |
| Restart the current puzzle   | `R`, or the **Reset** button                   |

When a peg is selected, the pegs you can legally move its disk to are
highlighted.

## Piece / board model

The board is three arrays, one per peg, holding disk sizes **bottom-to-top**:

```js
pegs = [ [4, 3, 2, 1], [], [] ]   // n = 4; peg A full, top disk = size 1
```

A larger integer is a physically larger disk. The **top** of a peg is the last
element of its array. This makes the rules trivial to check and lets tests build
exact positions directly.

State globals (all `var`, readable/assignable from tests, mirroring the other
board games in this repo):

| Global        | Meaning                                             |
|---------------|-----------------------------------------------------|
| `pegs`        | `[[], [], []]` disk stacks (bottom→top)             |
| `numDisks`    | current disk count                                  |
| `moves`       | moves made so far                                   |
| `minMoves`    | optimal move count, `2**numDisks - 1`               |
| `state`       | `'playing'` or `'won'`                              |
| `selected`    | index of the picked-up peg, or `null`               |
| `best`        | `{ [diskCount]: fewestMoves }`, persisted           |

## Core functions

- `reset(n)` — rebuild the puzzle with `n` disks (all on peg A).
- `topDisk(peg)` — the size on top of a peg array, or `null` if empty.
- `canMove(from, to)` — whether the top of `from` may legally land on `to`
  (non-mutating; used for both rules and highlight).
- `moveDisk(from, to)` — perform a legal move, bump `moves`, detect a win.
  Returns `true` if the move was made.
- `isWon()` — all disks on peg C.
- `solutionMoves(n)` — the canonical optimal `[from, to]` move list (length
  `2**n - 1`), used by the auto-solver and proven correct in tests.
- `handlePegClick(i)` — the click state machine (select / move / reselect).
- `setDiskCount(n)` — switch disk count and restart.
- `solve()` — restart and animate the optimal solution.

## The auto-solver

`solutionMoves(n)` is the textbook recursive algorithm: to move `k` disks from
`from` to `to` using `via`, move `k−1` from `from` to `via`, move the largest
disk `from → to`, then move `k−1` from `via` to `to`. It is deterministic and
always optimal. `solve()` restarts the puzzle and plays this list back on a
timer for a visual demo.

## Testable architecture

All logic lives in free functions on `window` and all state in `var` globals, so
the Playwright suite drives the puzzle purely through the data model — building
positions with direct `pegs` assignment, asserting `moveDisk` legality, and
proving that applying `solutionMoves(n)` from the start reaches a win in exactly
`2**n - 1` moves. Rendering is a separate `draw()` that reads the same state.

## Assumptions

Ambiguous points; the simpler interpretation was chosen and is noted here:

- **Start peg is A (left), target peg is C (right).** The middle peg B is the
  spare. This is the conventional presentation.
- **Winning requires all disks on peg C specifically**, not "any peg other than
  the start". This matches the classic statement of the puzzle.
- **Default disk count is 4** (optimal 15 moves) — a good balance of interesting
  and quick. The player can switch to 3, 5, or 6.
- **The Solve button restarts the puzzle** and plays the canonical solution from
  a clean position, rather than solving from an arbitrary mid-game state. This
  keeps the solver simple and always optimal.
- **"Best" is the fewest moves** achieved for a given disk count, saved to
  `localStorage`; an optimal solve sets it to `2ⁿ − 1`.
- **Illegal moves are simply rejected** (no penalty, no move counted). Clicking a
  peg you can't move onto instead reselects that peg if it has a disk.
