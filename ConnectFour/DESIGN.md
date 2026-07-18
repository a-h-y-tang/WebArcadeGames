# Connect Four — Design

## Game concept

The classic two-player "drop and connect" game on a 7-column × 6-row vertical
grid. You play **Red** against a computer-controlled **Yellow**. Players take
turns dropping a disc into a column; the disc falls to the lowest empty slot.
The first player to line up **four of their discs in a row** — horizontally,
vertically, or diagonally — wins. If the board fills with no four-in-a-row, the
game is a draw.

## Mechanics

### The board
- 7 columns, 6 rows. Internally a `board[row][col]` grid where row 0 is the top
  and row 5 is the bottom; `0` = empty, `1` = red, `2` = yellow.
- **Gravity:** dropping a disc into a column fills the lowest empty row in that
  column. Dropping into a full column is rejected (no-op).

### Turns
- Red (the human) always moves first.
- After a valid move the turn passes to the other player, *unless* the move wins
  the game or fills the board.
- After the human moves, the Yellow AI automatically takes its turn.

### Winning & draws
- After every drop the mover is checked for four-in-a-row in all four
  orientations (horizontal, vertical, and both diagonals). A win sets
  `winner` and moves `state` to `'over'`.
- If the board is completely full with no winner, `winner` is set to `'draw'`
  and the game ends.

### The Yellow AI
A deterministic one-ply heuristic, chosen so it plays a real game yet is fully
unit-testable:
1. If Yellow can complete four-in-a-row this move, take it (win immediately).
2. Otherwise, if Red threatens to win on their next move, drop into that column
   to block it.
3. Otherwise, play the legal column closest to the centre (column order
   `3, 2, 4, 1, 5, 0, 6`) — the centre is the strongest square in Connect Four.

Columns are always scanned in a fixed order, so the AI's choice is deterministic
for any given board.

### Match score
A running tally of Red wins, Yellow wins and draws is kept in the HUD and
persisted to `localStorage` so it survives reloads.

## Controls

| Action              | Input                                        |
|---------------------|----------------------------------------------|
| Drop a disc         | Click a column (or move mouse + press a key) |
| Drop in column 1–7  | Number keys `1`–`7`                          |
| New game            | `R`, or the New Game button                  |

A hovering "ghost" disc previews where your piece will land in the column under
the mouse.

## Architecture / testability

`game.js` runs in the global scope (matching the other games in this repo), so
the Playwright tests read and drive internal state directly via `page.evaluate`:

- **State globals:** `board`, `currentPlayer` (`1` | `2`), `state`
  (`'playing' | 'over'`), `winner` (`0` | `1` | `2` | `'draw'`).
- **Pure logic functions** exposed as globals so tests can build exact
  positions and assert outcomes:
  - `reset()` — clear the board and start a new game.
  - `dropDisc(col)` — drop the current player's disc; returns the landing row
    or `-1` if illegal. Handles win/draw detection and turn switching.
  - `isColumnFull(col)`, `legalColumns()` — column availability helpers.
  - `checkWinner()` — scan the board and return `0`, `1`, `2`, or `'draw'`.
  - `aiChooseColumn()` — the deterministic heuristic (returns a column, no side
    effects), and `aiMove()` which applies it.
  - `setCell(row, col, player)` — a test hook for constructing scenarios.

Because all game logic is separated from rendering (`draw()` only paints the
current state), no test needs the canvas pixels — every rule is asserted against
the data model.

## Assumptions

- **DESIGN.md casing.** The task asked for `DESIGN.md`; the repo's existing games
  use lowercase `design.md`. I followed the explicit task instruction.
- **Pre-existing broken `playwright.config.js`.** On `main` the shared config had
  duplicated `const` declarations (`fs`, `PREINSTALLED_CHROMIUM`,
  `launchOptions`), a `SyntaxError` that stopped *every* game's tests from
  running. I fixed it on this branch since the task requires a passing suite.
- **Human vs AI (not hot-seat).** The simpler, self-contained interpretation:
  the human is always Red and moves first; Yellow is the computer.
- **Deterministic one-ply AI.** Strong enough to be a worthy opponent (it never
  misses an immediate win or an immediate block) while remaining fully
  predictable for tests. It does not look more than one move ahead.
- **After a human move the AI replies immediately** within the same interaction
  (a short delay is used only for visual pacing in the browser; tests call
  `aiMove()`/`dropDisc()` directly).
