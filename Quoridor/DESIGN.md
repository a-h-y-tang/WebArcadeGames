# Quoridor — Design

## Concept

Quoridor is an abstract strategy race for two players on a 9×9 board. Each side
has one pawn and a stock of ten **fences**. The human pawn starts on the middle
square of the bottom row and wins by reaching *any* square of the top row; the
computer pawn starts on the top row and wins by reaching the bottom row.

On your turn you do exactly one of two things:

- **Step** your pawn one square orthogonally, or
- **Place a fence** in the grooves between cells, spanning two cells.

Fences block movement but may never *seal* a pawn off: after any placement both
pawns must still have some route to their goal row. That single restriction is
what turns the game from a maze-building contest into a race — you can slow your
opponent down, but never stop them.

## Mechanics

### Board model

- Cells are addressed `(r, c)` with `r = 0` at the top, both in `0..8`.
- Fences live on an 8×8 grid of **grooves**, addressed `(r, c)` in `0..7`, plus
  an orientation:
  - horizontal `h` at `(r, c)` separates rows `r`/`r+1` across columns `c` and `c+1`
  - vertical `v` at `(r, c)` separates columns `c`/`c+1` across rows `r` and `r+1`
- `isBlocked(r1, c1, r2, c2)` answers "is there a fence between these two
  adjacent cells?" and is the single chokepoint every rule goes through — moves,
  jumps and the pathfinder all consult it, so there is one place where wall
  geometry can be wrong.

### Fence legality

A fence at `(r, c, o)` is legal when all of the following hold:

1. The slot is inside the 8×8 groove grid.
2. The placing player still has fences in stock.
3. No fence already occupies slot `(r, c)` — this one check also rejects the
   *cross* case, because a horizontal and a vertical fence through the same
   intersection would both claim that slot.
4. No same-orientation fence overlaps: `h` conflicts with `h` at `(r, c±1)`;
   `v` conflicts with `v` at `(r±1, c)`.
5. With the fence tentatively added, **both** pawns still have a path to their
   goal row (breadth-first search from each pawn).

### Pawn moves and jumps

`legalMoves(player)` implements the standard jump rules:

- A step onto an empty, unfenced adjacent square is legal.
- If the *opponent* occupies the adjacent square, you hop straight over it to the
  square beyond — provided that square is on the board and no fence stands
  behind the opponent.
- If the straight hop is impossible (a fence behind the opponent, or the board
  edge), you may instead move diagonally to either square beside the opponent,
  again subject to fences.

### Pathfinding

`shortestPath(player)` is a breadth-first search over open neighbours from the
pawn to its goal row, returning the number of steps or `null` when no route
exists. It deliberately **ignores the opposing pawn**: a pawn is never a
permanent obstacle (it can be jumped, and it moves anyway), so treating it as
empty keeps the search a pure function of the wall layout. This function does
triple duty — fence validation, the AI's evaluation, and the tests.

## Computer opponent

The AI is a one-ply greedy search with a two-line evaluation:

```
score = shortestPath(human) - shortestPath(computer)
```

It scores every legal pawn step and every legal fence placement, then takes the
best. A move that lands on the goal row scores `Infinity`, so the AI never passes
up an immediate win.

Ties normally go to *stepping*: a fence is a finite resource and a step is not,
so the fence is only spent when it strictly beats walking — which works out to
"when it costs the human at least two extra steps", since a step is always worth
one point of progress.

**The tempo exception.** That rule alone produces an AI that never places a
fence, and the reason is worth writing down. Both actions shift the margin by
exactly one — a step cuts the computer's own distance, a one-step fence adds to
the human's — so on an open board no fence ever *strictly* beats walking, and the
game degenerates into a pure race. But the human moves first, so a level race is
one the computer loses by a single tempo; walking alone can never claw that back.

So when the computer is behind on tempo — when stepping would still leave the
human on move needing no more steps than it does (`losingTheRace()`) — it breaks
ties toward the fence instead, provided the fence actually costs the human
something. Each such fence buys a tangle rather than an immediate gain, and it is
in that tangle that the two-step opportunities its ordinary rule is waiting for
start to appear. In practice the computer spends its whole stock over the course
of a game and plays a genuine race rather than a procession.

Because every candidate fence is filtered through `canPlaceWall` first, the AI
inherits the "never seal anyone in" guarantee for free. Scoring 128 candidate
fences means a few hundred searches over an 81-cell graph per turn, measured at
roughly 5–8 ms (35 ms on the very first call, before the JIT warms up) — far
inside the deliberate 420 ms "thinking" pause, so the opponent always feels
instant.

The AI is fully deterministic — no randomness anywhere in the game — which is
what lets the test suite play whole games and assert on the outcome.

## Controls

| Input | Action |
|---|---|
| Click a glowing square | Move your pawn there |
| Click a groove between cells | Place a fence in the current orientation |
| ← ↑ → ↓ (or WASD) | Step one square (auto-jumps when face to face) |
| R / right-click | Rotate the fence between horizontal and vertical |
| Space | Start / restart |
| New Game button | Restart |

A live preview of the fence follows the pointer: green when the placement is
legal, red when it is not (overlapping, out of stock, or trapping a pawn).

## Determinism & testing

Following the pattern used by the other games in this repo, the game is a single
classic (non-module) script, so its state (`state`, `turn`, `pawns`, `walls`,
`wallsLeft`, `winner`) and its rules (`legalMoves`, `isLegalMove`, `movePawn`,
`canPlaceWall`, `placeWall`, `isBlocked`, `shortestPath`, `hasPath`, `aiMove`)
are reachable from Playwright as plain globals.

The rules layer is synchronous and side-effect free apart from the state it
owns; there is no animation-frame timing in it and no randomness. Tests set up
exact positions by assigning `pawns[...]` directly, then assert on the rules.
The only timer in the game is the AI's "thinking" delay, so tests set the global
`autoAI = false` and call `aiMove()` themselves when they want a deterministic
turn order; one test leaves it on to prove the automatic turn works.

The suite (`tests/quoridor.spec.js`, 58 tests) was written before the
implementation and covers: the idle/start states, all movement and jump cases,
every fence-legality rule, pathfinding, win detection, the AI, and the
click/keyboard mapping onto canvas coordinates.

## Assumptions

These choices were made where the brief was open-ended; the simpler option was
taken each time and recorded here:

- **Branch name.** The task asked for a branch named after the game
  (`quoridor`), but this session is pinned to the pre-assigned development
  branch `claude/loving-euler-g5qhr7` and is told never to push elsewhere. The
  pinned branch wins; the work is otherwise exactly as described.
- **Human vs computer only.** Quoridor also has a four-player variant and a
  two-human mode. Only 1-vs-1 against the computer is implemented — the simplest
  complete game.
- **The pawn is ignored by the pathfinder.** Standard practice for Quoridor
  engines, and it keeps fence validation independent of pawn positions.
- **Single AI difficulty.** One greedy one-ply opponent rather than a difficulty
  selector. It plays a competent race and spends fences sensibly, which is
  enough to make the game interesting without a search tree.
- **No draw handling.** With fences unable to seal anyone in, and both sides
  always able to advance, the game always terminates in a win; no stalemate or
  repetition rule is implemented.
- **Fence orientation is a mode, not a drag.** Real-world implementations often
  let you drag a fence to orient it. Here orientation is a toggle (R, right
  click, or the button) and a click drops the fence — fewer states, and it makes
  placement testable as a single click.
- **No score persistence.** Unlike the arcade games in this repo there is no
  high score to keep; each game is a self-contained match, so nothing is written
  to `localStorage`.
