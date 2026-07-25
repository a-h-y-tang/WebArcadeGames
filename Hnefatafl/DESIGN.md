# Hnefatafl (Brandub 7×7) — Design

## Concept

Hnefatafl ("king's table") is an ancient Norse strategy game of asymmetric
warfare. This implementation is **Brandub**, the compact 7×7 Irish variant.

Two unequal sides face off on a 7×7 board:

- **Defenders (the King's side)** — a **King** on the central throne, guarded by
  **4 defenders**. The King's side wins by escorting the King to any of the
  four **corner refuges**.
- **Attackers** — **8 attackers** positioned in a cross around the board edges.
  They win by **capturing the King**.

The player controls the **Defenders** (gold, with the King). A deterministic
built-in AI plays the **Attackers** (dark). As is traditional in tafl games,
the **Attackers move first**.

## Board

```
.  .  .  A  .  .  .
.  .  .  A  .  .  .
.  .  .  D  .  .  .
A  A  D  K  D  A  A
.  .  .  D  .  .  .
.  .  .  A  .  .  .
.  .  .  A  .  .  .
```

- `K` King on the central **throne** `(3,3)`.
- `D` Defenders at the four squares orthogonally adjacent to the King.
- `A` Attackers: two extending inward from the midpoint of each edge.
- The four **corners** `(0,0) (6,0) (0,6) (6,6)` are the King's escape refuges.

Coordinates are `(col, row)`, both 0–6, origin at the top-left.

## Mechanics

### Movement
- Every piece (King, defenders, attackers) moves **orthogonally any number of
  empty squares**, exactly like a rook in chess.
- Pieces **cannot jump** over other pieces, and cannot land on an occupied
  square.
- The **throne** and the four **corners** are **restricted**: only the King may
  stop on them. Other pieces may pass **through** the empty throne but may not
  stop on it, and may never enter a corner.

### Capturing soldiers (custodial capture)
- A soldier (attacker or defender) is captured when the moving player sandwiches
  it **between two hostile pieces** along a row or column — i.e. the mover lands
  so an enemy soldier sits directly between the just-moved piece and another
  friendly piece.
- The **corners** and the **throne square** count as hostile anchors for a
  capture (a soldier can be pinned against them).
- Captures are only caused by the moving side. **Moving your own piece into the
  gap between two enemies is safe** — it is not self-capture.
- A single move can capture up to three soldiers (one per direction).

### Capturing the King
- The King is **immune to ordinary custodial capture**. Instead the King is
  captured only when **every on-board orthogonal neighbour is an attacker or the
  throne square**. In the open that requires 4 attackers; against the throne or
  the board edge, fewer (the board edge simply does not need to be filled).
- The King capture is only ever evaluated immediately after an **attacker's**
  move.

### Winning
- **Defenders win** the instant the King moves onto any corner refuge.
- **Attackers win** the instant they capture the King.

## Controls

- **Click** one of your pieces (a defender or the King) to select it; its legal
  destinations are highlighted.
- **Click** a highlighted square to move there. The Attacker AI then responds
  automatically.
- **New Game** button (or the overlay) starts / restarts.

## Rendering

- A single `<canvas>` at **560 × 560** (7 × 80 px cells). Throne and corners are
  marked; the selected piece and its legal moves are highlighted. A status line
  shows whose turn it is and the result.

## Testability

Following the repo convention, the entire rule engine is pure and lives in
module-scope globals so Playwright can drive it deterministically:

- State: `board` (`board[row][col]`), `turn` (`'attackers' | 'defenders'`),
  `state` (`'playing' | 'attackers-win' | 'defenders-win'`), `SIZE`.
- Piece constants (globals): `EMPTY=0`, `ATTACKER=1`, `DEFENDER=2`, `KING=3`.
- `newGame()` — reset to the Brandub starting position (turn = attackers).
- `move(fc, fr, tc, tr)` — validate + apply a move for the side to move,
  resolve captures, check victory, toggle the turn. Returns `true` if legal.
- `aiMove()` — compute and play the Attackers' best move (fully deterministic:
  no randomness, stable tie-breaking). Returns the chosen `{fc,fr,tc,tr}`.
- `legalMovesFrom(c, r)` — the destination list for a piece.
- `pieceAt(c, r)`, `kingPos()`, `isCorner(c, r)`, `isThrone(c, r)`.
- Test helpers `clearBoard()` and `place(c, r, piece)` build custom positions.

The AI has **no random component** — given a board it always chooses the same
move — so AI behaviour itself is unit-testable.

## Assumptions

Where the historical rules vary, the simpler interpretation was chosen and noted
here:

- **Edge King captures:** the board edge does not need to be "filled" to capture
  the King, so a King on the edge can be caught by 3 attackers (and on the throne
  edge, fewer). This is a common, playable variant and keeps the game winnable
  for the Attackers against a lightweight AI.
- **Throne as anchor:** the throne square always acts as a hostile anchor for
  soldier captures and as a blocking side for the King capture, whether or not it
  is occupied.
- **No stalemate/no-moves rule:** a side with no legal move is not specially
  handled (it does not arise from normal play in Brandub within a reasonable
  game); the game simply continues on the other side's turn.
- **Player side:** the human always plays the Defenders (King side); the AI
  always plays the Attackers and moves first.
- **Repetition:** no draw-by-repetition rule is implemented.
