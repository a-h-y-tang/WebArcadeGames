# Nine Men's Morris — Design

## Concept

Nine Men's Morris (a.k.a. Mill) is a classic two-player strategy board game
dating back to the Roman Empire. You (**White**) play against a computer
opponent (**Black**) on a board of 24 points arranged as three nested squares
joined by four connecting spokes. Each side has nine pieces. Line up three of
your pieces along a marked line — a **mill** — and you get to remove one of your
opponent's pieces. Grind your opponent down to two pieces, or leave them with no
legal move, and you win.

It is a pure, deterministic game of perfect information, which makes its rules a
natural fit for the repo's Playwright-driven, `page.evaluate`-based testing
style: the whole game is a set of small pure functions over a 24-cell board.

## The board

24 points, indexed 0–23, three concentric rings of eight points each (four
corners + four edge midpoints), with the ring midpoints joined by spokes:

```
0 ----------- 1 ----------- 2
|             |             |
|    3 ------ 4 ------ 5    |
|    |        |        |    |
|    |    6-- 7 --8    |    |
|    |    |       |    |    |
9 - 10 - 11      12 - 13 - 14
|    |    |       |    |    |
|    |   15--16--17    |    |
|    |        |        |    |
|   18 ----- 19 ----- 20    |
|             |             |
21 ---------- 22 ---------- 23
```

- **Adjacency** (`ADJ`) — which points are connected by a line, used for sliding
  moves.
- **Mills** (`MILLS`) — the 16 lines of three (8 horizontal + 8 vertical) that
  count as a mill.

## Rules & phases

Each player owns nine pieces. Play has three phases, tracked **per player**:

1. **Placing** — while a player still has pieces in hand, their turn is to place
   one on any empty point.
2. **Moving** — once a player's hand is empty, their turn is to slide one of
   their pieces to an adjacent empty point.
3. **Flying** — when a player is reduced to exactly three pieces, they may move
   a piece to *any* empty point, not just an adjacent one.

Forming a mill (by placing or moving) lets the mover **remove** one opposing
piece. A piece that is part of a mill cannot be removed unless every opposing
piece is in a mill.

A player **loses** when reduced to two pieces, or when it is their turn to move
and they have no legal move.

## The computer opponent

Black plays a simple, fully **deterministic** heuristic (no randomness), so
every game is reproducible and testable:

- **Place / move**: complete a mill if possible; otherwise block an opponent
  mill that is one move from completing; otherwise take the move that maximises
  the mover's "two-in-a-line" threats, breaking ties by lowest index.
- **Remove**: take a legal opponent piece that is part of a two-in-a-line threat
  if there is one; otherwise the lowest-indexed legal piece.

## Controls

Nine Men's Morris is played entirely with the mouse:

| Action | Input |
|---|---|
| Place a piece / select one to move / choose its destination | **Click** a point |
| Remove an opponent piece (after you form a mill) | **Click** the piece |
| Start / restart | **Start** button, **Space**, or click when idle |

Click a highlighted point. When it is your turn to move, click one of your
pieces to select it (its legal destinations are highlighted), then click a
destination. Clicking the selected piece again, or another of your pieces,
changes the selection.

## State exposed for testing

`game.js` keeps its core state and pure helpers at module scope so the Playwright
suite can drive and inspect the game directly: `board` (24-cell array of
`0`/`1`/`2`), `turn`, `hand` (pieces left to place, per player), `state`,
`mustRemove`, `selected`, `winner`, and the functions `place`, `move`, `remove`,
`handlePoint`, `formsMill`, `wouldFormMill`, `legalMoves`, `count`, `phaseOf`,
`isFlying`, `aiTakeTurn`, `checkWin`, `startGame`, and `reset`, plus the board
data `ADJ`, `MILLS`, `POINTS`, and the constant `PIECES_PER_PLAYER`.

## Assumptions

Resolved toward the simpler interpretation, per the task brief:

- **The human is always White and always moves first.** No side-selection UI.
- **A single-move mill removal is mandatory and immediate** — after forming a
  mill the mover must remove a piece before play continues; the UI enforces this
  by waiting for the removal click.
- **The AI is a greedy heuristic, not a full minimax search.** It plays a
  reasonable, deterministic game without the complexity (and non-determinism
  risk) of a search with tie-breaking randomness.
- **"No legal move" is only evaluated in the moving phase.** During placing
  there is always an empty point, so a player can never be stalemated then.
- **Best result is not persisted.** Unlike the arcade score games, a board game
  has no running score; the game simply reports the winner.
