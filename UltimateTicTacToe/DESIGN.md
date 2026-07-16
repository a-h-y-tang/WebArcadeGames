# Ultimate Tic-Tac-Toe — Design

## Concept

Ultimate Tic-Tac-Toe is a strategic expansion of noughts-and-crosses played on a
**3×3 grid of 3×3 boards** (81 cells total). You play **X** (the human) against a
computer-controlled **O**. Winning the game is not about a single mini-board —
it's about winning **three mini-boards in a row** on the big (macro) board.

The twist that makes the game deep is the **forced-board rule**: the cell you
play *inside* a mini-board dictates *which* mini-board your opponent must play in
next. So every move is both an attack in one board and a decision about where to
send your opponent.

This game is deliberately distinct from the repo's other line-up games:

- **Tic-Tac-Toe** (not in the repo) is trivially solved; this is not.
- **Connect Four** drops discs under gravity; **Reversi** flanks and flips.
- **Ultimate Tic-Tac-Toe** nests boards and adds the send-your-opponent
  constraint — a genuinely different, non-trivial strategy game.

## Board & rendering

- A macro board of 9 **mini-boards** (indices `0..8`, row-major), each a 3×3 grid
  of **cells** (indices `0..8`, row-major).
- Geometry (constants in `game.js`):
  - `SIZE = 540` — canvas is `540 × 540`.
  - `MINI = 180` — a mini-board is 180 px square.
  - `CELL = 60` — a cell is 60 px square.
  - Mini-board `b` sits at macro position `(row = b/3, col = b%3)`.
  - Cell `c` within it sits at `(row = c/3, col = c%3)`.
  - Cell `(b, c)` centre pixel:
    `x = (b%3)*MINI + (c%3)*CELL + CELL/2`, `y = (b/3)*MINI + (c/3)*CELL + CELL/2`.
- Thin lines divide cells; thick lines divide mini-boards.
- The mini-board(s) the current player is allowed to play in are highlighted.
- A won mini-board is shaded in the winner's colour and stamped with a large
  X or O; a drawn (full, no winner) mini-board is greyed out.

## State

- `boards` — array of 9 mini-boards, each an array of 9 cells. `0` empty,
  `1` X, `2` O.
- `macro` — array of 9: the status of each mini-board. `0` undecided,
  `1` won by X, `2` won by O, `3` drawn (full, no winner).
- `currentPlayer` — `1` (X) or `2` (O). X moves first.
- `activeBoard` — the mini-board index the current player must play in, or
  `-1` for "any board" (free choice).
- `state` — `'playing' | 'won' | 'draw'`; `winner` — `0 | 1 | 2`.
- `winLine` — the three macro indices that won, for highlighting.
- `scores` — `{ x, o, draws }`, persisted to `localStorage` (`uttt-score`).

## Rules / mechanics

- **X moves first** with a free choice of any board (`activeBoard = -1`).
- A move at cell `c` sends the opponent to **mini-board `c`**. If that board is
  already decided (won or drawn), the opponent gets a **free choice**
  (`activeBoard = -1`).
- A move is **legal** iff: the game is in progress, the target cell is empty, its
  mini-board is undecided, and (the move is in `activeBoard` *or* `activeBoard`
  is `-1`).
- Winning three cells in a line (row, column, diagonal) wins that mini-board and
  sets `macro[b]`.
- Winning three mini-boards in a line on the macro board **wins the game**.
- If every mini-board is decided with no macro line, the game is a **draw**.
- A running match score (X / Draws / O) is kept and persisted to `localStorage`.

## The opponent (deterministic AI)

O evaluates only its **legal** moves and picks the best, deterministically (no
randomness — fixed scan order breaks ties), via `chooseAiMove()`:

1. **Win the game** — if a legal move completes three mini-boards in a row, play it.
2. **Win a mini-board** — otherwise prefer a move that wins a mini-board,
   *unless* it hands the opponent an immediate game-winning reply.
3. **Heuristic** — otherwise score each legal move by: mini-board threats it
   creates, whether it wins/claims useful macro squares (centre and corners are
   worth more), minus a penalty for sending the opponent to a board where they
   can immediately win a mini-board or the game.

The AI always takes an immediate game win and never plays an illegal move, which
keeps it a fair, testable opponent without any search tree.

## Controls

| Action        | Input                                    |
|---------------|------------------------------------------|
| Place a mark  | Click a legal (highlighted) cell         |
| New game      | `R`, or the **New Game** button          |

X (you) always moves first; O (computer) replies automatically.

## Public API exposed for tests

Declared as top-level `var`/`function` globals (matching the repo's other games):

- State: `boards`, `macro`, `currentPlayer`, `activeBoard`, `state`, `winner`,
  `winLine`, `scores`.
- Pure logic: `emptyBoards()`, `lineWinner(arr)`, `miniWinner(b)`,
  `isMiniFull(b)`, `updateMacro(b)`, `isLegal(b,c)`, `legalMoves()`,
  `macroWinner()`, `isMacroFull()`, `chooseAiMove()`.
- Flow: `applyMove(b,c,player)`, `humanMove(b,c)`, `aiMove()`, `newGame()`.

## Assumptions

Interpretations chosen (the simpler reading, per the task brief), recorded here:

- **"Send to a decided board ⇒ free choice."** The most common modern rule.
  (Some variants send you to a specific board and skip; free-choice is simpler
  and the widely-played version.)
- **A drawn mini-board counts for neither** side on the macro board (`macro`
  value `3` is treated as "not a line" for macro win detection).
- **X is the human and moves first.** Traditional; keeps the human on the
  first-move initiative.
- **Single-ply AI (no deep search).** A heuristic that always takes an immediate
  game win, prefers winning mini-boards, and avoids handing the opponent an
  immediate win is a fair, fully deterministic opponent. It is not expected to
  play a perfect forcing game.
- **AI reply delay** (~300 ms) is cosmetic; tests drive the logic functions
  directly, so timing never affects correctness.

## Files

- `index.html` — page layout, HUD, scoreboard, canvas.
- `style.css` — presentation.
- `game.js` — all game logic and rendering.
- `tests/ultimate-tic-tac-toe.spec.js` — Playwright test suite (written first).
- `README.md` — how to play.
