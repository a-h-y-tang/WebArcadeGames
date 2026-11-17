# Chess — design notes

## Game concept

Full-rules chess against a built-in engine, drawn on an HTML5 canvas with plain
JavaScript. No build step, no dependencies, no network: open `index.html` and
play. You are White at the bottom of the board; the engine answers as Black.

Chess is a classic board game, so per the repository's content policy it stays
unthemed — a theme here would only be decoration. The piece glyphs are the
standard Unicode chess characters, so there is no artwork to load.

## Board representation

```
board[r][c]   r = 0 is rank 8 (top of the screen), r = 7 is rank 1
              c = 0 is file a,  c = 7 is file h
```

A square holds `''` (empty) or a single FEN character: `PNBRQK` for White,
`pnbrqk` for Black. That choice means a position serialises to FEN almost for
free, and FEN is used for three separate jobs:

- **tests** — set up an exact position in one line;
- **repetition detection** — the board/turn/castling/en-passant part of the FEN
  is the repetition key;
- **undo** — the move history stores a FEN snapshot per ply.

A *position* is the plain object

```js
{ board, turn: 'w'|'b', castling: 'KQkq', ep: null|[r,c], halfmove, fullmove }
```

and `applyMove(p, move)` returns a **new** position rather than mutating `p`.
Copying an 8×8 array per node is fast enough for a 3-ply search and removes the
whole class of make/unmake bugs, which matters more here than raw node speed.

A *move* is

```js
{ from: [r,c], to: [r,c], piece, capture: ''|char, promo: null|'q'|'r'|'b'|'n',
  castle: null|'K'|'Q', ep: bool, dbl: bool }
```

## Rules implemented

Everything a normal game needs:

- all six piece movements, with sliding pieces blocked by the first occupied square;
- **castling** both sides, refused if the king or that rook has moved, if a
  square between them is occupied, if the king is in check, or if the king would
  pass through or land on an attacked square;
- **en passant**, offered only on the ply immediately after the double push;
- **promotion** to queen, rook, bishop or knight (the move generator emits all
  four, so the engine can under-promote; the player picks from a small overlay);
- **check** and **checkmate**, **stalemate**;
- draws by the **fifty-move rule** (100 half-moves without a capture or a pawn
  move), **threefold repetition**, and **insufficient material**.

Legality is filtered the simple way: generate pseudo-legal moves, apply each one,
and drop it if your own king is attacked afterwards. `squareAttacked()` does the
attack test directly from the target square outwards, so it never needs a move
list and cannot recurse.

The move generator is verified by `perft` — counting the leaf nodes of the move
tree — against the five standard published positions, which is the test that
actually pins down the awkward corners (en-passant discoveries, castling out of
and through check, promotion captures).

## Notation

Moves are rendered as standard algebraic notation (`Nf3`, `exd5`, `O-O-O`,
`e8=Q+`, `Qxf7#`) with the usual disambiguation: file first, then rank, then both
when a file and rank are each shared. The move list scrolls beside the board, so
a game can be read back.

## The engine

`chooseMove()` runs alpha-beta over `search()`:

- **depth** 3 plies, then a captures-only quiescence search (4 plies) so the
  engine does not stop counting in the middle of a trade;
- **ordering** — promotions and captures first by most-valuable-victim /
  least-valuable-attacker, which is what makes alpha-beta cut anything;
- **evaluation** — material (1/3.2/3.3/5/9) plus a piece-square table per piece
  type, a small bishop-pair and mobility term, and a pawn-shield term for the
  castled king. Mate is ±100000 adjusted by distance, so the engine prefers the
  shorter mate and the longest defence.

The engine plays its reply after a short delay so the player sees their own move
land first.

## Controls

| Input | Action |
|---|---|
| Click a piece, then a highlighted square | Make a move |
| Click the piece again, or an empty square | Deselect |
| Promotion overlay buttons | Choose the promotion piece |
| `U` | Undo (takes back your move and the engine's reply) |
| `R` | New game |
| `Space` / Start button | Start |

Everything is click-driven; there is no drag, because click-to-move is easier to
hit on a touch screen and needs no pointer capture.

## Files

| File | Contents |
|---|---|
| `index.html` | Canvas, HUD, overlays, move list |
| `style.css` | Layout and theme |
| `game.js` | Rules, notation, engine, rendering, input |
| `tests/chess.spec.js` | Playwright suite (written first) |

## Assumptions

Decisions taken without asking, as the task requires them to be recorded:

1. **The player is White** and the engine is Black. No colour picker: it is one
   more control to explain, and the simpler reading of "play chess" is that the
   human moves first.
2. **Search depth 3 + quiescence** rather than a deeper, slower engine. It plays
   a sound club-beginner game, answers in well under a second on a phone, and
   keeps the file readable. There is no difficulty selector.
3. **Draws are claimed automatically.** Threefold repetition and the fifty-move
   rule end the game as soon as they occur instead of offering a claim, because
   there is no opponent to negotiate with.
4. **Insufficient material** is the practical subset: no pawns, rooks or queens
   on the board and neither side holding more than one bishop or knight. Rarer
   dead positions (two same-colour bishops, K+N+N vs K) are not detected and
   simply play on to the fifty-move rule.
5. **No clock**, no opening book, no PGN import/export, no board flip. The move
   list is on screen; saving it is out of scope.
6. **Undo removes a full move pair** (your ply and the engine's reply), which is
   what a player means by "take that back". Undo during the engine's think time
   cancels the pending reply.
7. **The engine breaks exact ties at random**, so games differ from one another.
   Tests that assert engine choices use positions with a single best move.
8. Board geometry is fixed at 70px squares (560×560 canvas), matching the other
   board games in this repository.
