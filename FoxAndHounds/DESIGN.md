# Fox and Hounds — Design

## Game concept

A classic asymmetric board game played on the dark squares of an 8×8 checkerboard.
One player is the lone **Fox**; the other commands four **Hounds**. The hounds
march down the board trying to **trap** the fox so it has nowhere to go; the fox
tries to **slip past** them and reach the hounds' home row at the top. It's a pure
game of blocking — nobody is ever captured.

Two players share the keyboard/mouse (hot-seat), taking turns — the same way the
repo's other abstract games (Reversi, Nine Men's Morris, Dots and Boxes) are
played.

## The board & setup

* 8×8 board; only the 32 **dark squares** (`(row + col)` odd) are ever used.
* **Hounds** start on the four dark squares of the top row: `(0,1) (0,3) (0,5)
  (0,7)`.
* The **Fox** starts on a dark square of the bottom row: `(7,4)`.
* The **Fox moves first**, then play alternates.

## Movement

* A piece moves **one step diagonally** onto an empty dark square.
* **Hounds move forward only** — downward, toward the fox's side: `(r+1, c±1)`.
  They can never retreat.
* **The Fox moves in any diagonal direction**: `(r±1, c±1)`.
* There are no jumps and no captures.

## Winning

* **Fox wins** by reaching the top row (`row 0`) — it has broken through the pack.
* **Hounds win** by trapping the fox: when it is the fox's turn and the fox has no
  legal move, the hounds have won.
* If it is the hounds' turn and **no hound can move**, the hounds must **pass** and
  the turn returns to the fox (the disciplined hounds have over-committed). If the
  fox is then also stuck, the hounds win.

## Controls

* **Click** one of your pieces to pick it up; its legal destinations are
  highlighted. Click a highlighted square to move there. Click elsewhere to
  deselect.
* **R** — restart.

## Rendering

Pure HTML5 Canvas 2D: a checkerboard, hounds drawn as pale discs, the fox as a
bright ember disc, with the selected piece ringed and its legal moves dotted. A
banner shows whose turn it is and announces the winner.

## Testability

Every rule is a pure function over global state, with no animation or timing, so
the Playwright suite builds exact positions and asserts outcomes deterministically:

* `isDark(r, c)` / `inBounds(r, c)` / `pieceAt(r, c)` — board queries.
* `legalMovesFrom(r, c)` — destinations for the piece there (respects the
  fox/hound direction rules).
* `hasMoves(side)` — does a side have any legal move?
* `tryMove(from, to)` — validate + apply a move, resolve wins, hand over the turn.
* `resolveTurn()` — the pass/trap logic run at the start of a side's turn.
* State globals: `fox`, `hounds`, `turn`, `state`, `selected`.
* Geometry helpers `cellCenter(r, c)` / `pixelToCell(x, y)` let interaction tests
  click real squares.

## Assumptions

* **Simpler interpretation chosen throughout** (the task's tie-breaker). The fox's
  objective is the concrete "reach row 0", rather than the fuzzier "get past all
  hounds so they can never catch you" — it is unambiguous and always decidable.
* Four hounds on an 8×8 board using only dark squares — the most common form of
  the game.
* The Fox moves first.
* Hot-seat two-player (no built-in AI opponent), matching the repo's other
  two-player abstract games. One person plays the fox, the other the hounds.
* No score/persistence — a match is a single decisive game, then restart.
