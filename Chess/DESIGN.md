# Chess — design notes

How the code is put together, why it is shaped this way, and what the tests
pin down. For the rules of play and the controls, see [README.md](README.md).

## Concept

Full standard chess against a computer opponent, on one HTML5 canvas with no
build step and no dependencies. Every rule of the game is implemented:
castling (both sides, with the right to castle lost correctly), en passant,
promotion to any of the four pieces, check, checkmate, stalemate, the
fifty-move rule, threefold repetition and draws by insufficient material.

The repository already has Checkers, Reversi, Gomoku, Hex, Hnefatafl, Nine
Men's Morris, Mancala, Fox and Hounds and Quoridor, but no chess — the one
board game nearly everyone already knows. It is filed under **Board Game** in
the game browser.

Chess is left unthemed, which `CLAUDE.md` allows for "classic board and card
games … when a theme would only be decoration". Renaming the pieces after
biblical figures would change nothing about how the game plays and would put
real people on a board where they get captured, which the content policy warns
against.

## Mechanics

### Board and position

A position is a plain object, and every function that takes one treats it as
read-only:

```js
{
  board:    Array(64),  // 'P','N','B','R','Q','K' white, lower case black, '' empty
  turn:     'w' | 'b',
  castling: { wK: bool, wQ: bool, bK: bool, bQ: bool },
  ep:       -1 | square index,   // the square a pawn may capture onto
  halfmove: int,                 // plies since the last capture or pawn move
  fullmove: int,
}
```

Squares are indexed 0–63 from **a8 = 0** to **h1 = 63**, i.e. the same order in
which a FEN board field is written and the same order the board is drawn in
when white is at the bottom. `fileOf` gives the column (0 for the a-file) and
`rankOf` the row counted from the top (0 is rank 8), which is what the array
index means; `squareName` and `squareOf` convert to and from algebraic names
like `e4`.

`parseFEN` and `toFEN` move between that object and a FEN string, so any test
or saved game can be expressed as one line of text. Every test position in the
suite is a FEN.

### Moves

A move is also a plain object:

```js
{ from, to, piece, captured, promo, flags }
```

`flags` is a set of strings drawn from `capture`, `double` (a pawn's two-square
advance), `ep`, `castle-k`, `castle-q` and `promo`.

`makeMove(pos, move)` returns a **new** position and never touches the one it
is given. Copying a 64-element array per node is cheap enough for the search
depths here, and in exchange the move generator, the search and the undo stack
all get to share one code path with no "unmake" bugs — the usual source of
chess engine errors. `undo` is simply a stack of previous positions.

Generation happens in two layers:

- `generatePseudoMoves(pos)` applies each piece's geometry: sliding pieces walk
  outward along their rays until they hit a piece or the edge, knights and kings
  use offset tables, pawns push, double-push from their home rank, capture
  diagonally and capture en passant. Castling is offered when the right is
  still held, the squares between king and rook are empty, and the king is not
  in check on its start, pass-through or landing square.
- `generateMoves(pos)` filters those by legality: make the move, and keep it
  only if the mover's king is not then attacked. That single check also handles
  pins, discovered checks and the requirement to answer a check, so there is no
  special-case code for any of them.

`isSquareAttacked(pos, sq, by)` asks the question from the square outwards —
knight offsets, king offsets, pawn diagonals, and rays for the sliders — rather
than generating all of the attacker's moves, which keeps it usable inside the
legality filter without recursion.

### Status and draws

`gameStatus(pos, history)` returns `playing`, `checkmate`, `stalemate`,
`draw-fifty`, `draw-material` or `draw-repetition`. No legal moves means
checkmate when the king is attacked and stalemate when it is not. The
fifty-move rule triggers at 100 half-moves. Insufficient material covers the
dead positions that come up in play: king against king, king and a single minor
piece, and king and bishop against king and bishop on the same colour squares.
Repetition counts identical positions in the game history by their FEN minus
the two counters, and draws on the third.

### Notation

`moveToSAN(pos, move)` writes standard algebraic notation for the move list:
piece letter, disambiguation by file then rank then both (only when two pieces
of the same kind can reach the square), `x` for captures, `=Q` for promotions,
`O-O` and `O-O-O` for castling, and `+` or `#` worked out by making the move
and looking at the result.

### The opponent

`searchBestMove(pos, depth)` is alpha-beta over `generateMoves`, with:

- material values plus a piece-square table per piece type, read from white's
  point of view and mirrored for black, so the engine develops pieces toward
  the centre and keeps its king home in the opening;
- a quiescence search over captures only at the leaves, so the evaluation is
  never taken in the middle of a trade;
- moves ordered captures-first (by captured value), which is what makes
  alpha-beta actually prune;
- mate scores adjusted by distance, so a mate in one is preferred to a mate in
  three.

Three difficulties drive it: **Gentle** searches one ply and picks at random
from the moves within a pawn of the best, **Steady** searches three plies, and
**Sharp** searches four. The move is computed inside a `setTimeout` so the
board can repaint and show "Thinking…" first; the tests call
`searchBestMove` directly instead and never wait on a timer.

A fixed opening book is deliberately absent. Instead, Gentle's random tie-break
keeps games from being identical, and the seeded `rng` behind it is exposed so
a test can make the choice deterministic.

### Rendering and input

One `draw()` paints everything from the current position: the board, the
file/rank labels, the last move, the selected square, a dot on every legal
target, a red wash under a king in check, and the pieces as Unicode glyphs
(filled white with a dark outline, or filled dark) so there are no image
assets to load.

Clicking is a two-step select-then-move: the first click selects one of your
own pieces, the second either plays a legal move to that square, selects a
different piece of yours, or clears the selection. A move that lands a pawn on
the far rank opens the promotion chooser and waits for it before the move is
played. The board can be flipped, and a new game can be started on either side.

## Controls

See [README.md](README.md). Mouse only, plus the buttons under the board.

## Test strategy

`tests/chess.spec.js` runs against `index.html` over `file://`. The game is a
classic (non-module) script, so its functions and state are plain globals and
`page.evaluate` can reach them — the same arrangement the other games in this
repo use.

The suite was written before the implementation and is in four parts:

1. **Rules.** Each piece's geometry, double pushes, en passant (offered,
   executed, and expiring), all four castling cases including through check,
   promotion to each piece, pins, and the obligation to answer a check.
2. **Perft.** Move-path counts from six standard published positions —
   including the start position to depth 4 (197,281) and "Kiwipete" to depth 3
   (97,862). These are the real test of the move generator: a single wrong
   castling or en passant rule moves the count.
3. **Outcomes and notation.** Checkmate, stalemate, fifty-move, insufficient
   material, threefold repetition, and SAN for ordinary moves, captures,
   castles, promotions, disambiguation and check/mate suffixes.
4. **Engine and interface.** That the search returns legal moves, finds mate in
   one for both colours and takes a free piece; and that clicking selects and
   moves, illegal clicks are rejected, the move list and captured material
   update, undo rolls back both sides, promotion runs through the chooser, flip
   and new game work, and the result overlay appears.

## Assumptions

Decisions taken without being asked, as the task allows:

- **Branch name.** The task asks for a branch named after the game, but this
  environment pins development to `claude/compassionate-ramanujan-yp1i3b` and
  forbids pushing elsewhere. The work is on that branch; the folder, title and
  PR carry the game's name.
- **Unthemed.** Chess stays chess, for the reason given above. The title screen
  carries no verse.
- **Two players share one keyboard rather than a network.** The *Opponent*
  setting turns the computer off and lets one person play both sides, which
  together with *Flip Board* covers two people at one screen. There is no
  online play: this repo has no server, and every game in it runs from a file.
- **Search depth over strength.** Four plies with quiescence is a club-level
  opponent, not a strong one. Going deeper in plain JavaScript on the main
  thread would make the page hang; a web worker would be the next step and is
  out of scope here.
- **Draw claims are automatic.** Fifty-move and threefold repetition end the
  game immediately rather than offering a claim, which is what a casual player
  expects.
- **No clock, no resignation, no saved games.** Only the chosen difficulty is
  remembered, in `localStorage`. A game in progress is lost on reload, as it is
  in the rest of the collection.
- **The search does not know about repetition.** `gameStatus` ends a game that
  repeats three times, but the engine itself does not avoid or seek a
  repetition, so a dead-drawn position may shuffle until the rule stops it.
