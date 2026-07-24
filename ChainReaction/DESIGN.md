# Chain Reaction — Design

## Concept

Chain Reaction is a two-player turn-based strategy game played on a grid. Each
player drops "orbs" into cells; when a cell holds as many orbs as it has
orthogonal neighbours it becomes unstable and **explodes**, pushing one orb into
each neighbour and **capturing** those cells for the exploding player. Explosions
can trigger further explosions, producing spectacular chain reactions that flip
large swathes of the board from one colour to the other. A player wins when they
capture every orb on the board.

This is a two-player **hotseat** game (Red vs Blue on the same keyboard/mouse),
so it is fully deterministic with no AI or randomness — a good fit for the
repo's other two-player board games (Connect Four, Reversi, Dots and Boxes).

The game runs on a single HTML5 `<canvas>` with no external assets or build
step — open `index.html` and play.

## Board & critical mass

- The board is a `ROWS × COLS` grid (default **6 × 6**).
- Every cell has a **critical mass** equal to its number of orthogonal
  neighbours:
  - **Corner** cells → 2
  - **Edge** cells → 3
  - **Interior** cells → 4
- Each cell tracks an orb `count` and an `owner` (`null`, `0` = Red, `1` = Blue).

## Mechanics

### Placing an orb

- On their turn a player clicks a cell that is **empty** or **already owned by
  them**. Placing adds one orb to the cell and sets its owner to that player.
- A player may **not** place into a cell owned by the opponent.

### Explosions & chain reactions

- After a placement, any cell whose `count >= criticalMass` is unstable and
  explodes:
  - Its count is reduced by its critical mass.
  - Each orthogonal neighbour gains **one** orb and is **captured** by the
    exploding player (its owner becomes the exploding player).
- Explosions cascade: neighbours pushed to their own critical mass explode in
  turn. The cascade repeats until the board is stable (no cell over critical
  mass) or the game is decided.
- Because the stable configuration is independent of the order in which
  simultaneous unstable cells are processed, the outcome is deterministic.

### Winning

- A player wins when, **after both players have made at least one move**, the
  opponent owns zero cells. The first-move guard prevents a false win on the
  opening move (when the second player naturally has no orbs yet).
- On a win the game enters the `over` state and shows the winner; the board can
  be reset for a new game.

## Controls

| Input | Action |
|-------|--------|
| Mouse click | Place an orb in the clicked cell (current player) |
| `R` | New game / reset the board |
| New Game button | Reset the board |

The current player is shown in the header and by the board's glowing border
colour.

## State machine

The global `state` variable is one of:

- `playing` — a game is in progress; the current player places orbs.
- `over` — a player has won; clicks are ignored until reset.

## Testable surface

To support TDD with Playwright, the game exposes its state and pure logic on
`window` so tests can drive and inspect it deterministically:

- `state` — `'playing'` or `'over'`.
- `current` — the player to move (`0` or `1`).
- `winner` — `null`, `0`, or `1`.
- `moveCount` — number of valid moves played this game.
- `grid` — `ROWS × COLS` array of `{ count, owner }`.
- Constants: `ROWS`, `COLS`, `CELL`.
- Functions: `newGame()`, `applyMove(r, c)` (returns whether the move was
  legal and applied), `criticalMass(r, c)`, `canPlace(r, c, player)`,
  `cellsOwnedBy(player)`.

`applyMove` performs the whole placement + full cascade + win check
synchronously, so tests never depend on timers or animation frames.

## Assumptions

- **Hotseat, no AI.** The task asked for the simpler interpretation where
  ambiguous; a two-player local game avoids AI heuristics and keeps every rule
  deterministic and testable. (Chose the simpler interpretation.)
- **Instant settle, no explosion animation.** The cascade resolves to its final
  stable state immediately and the board is redrawn once. This keeps the
  simulation free of wall-clock timing (and therefore test flakiness); a
  time-based animation was deliberately left out for simplicity.
- **Cascade safety cap.** A generous iteration cap guards against a theoretical
  infinite cascade once the game is already decided; in practice the win check
  stops the cascade as soon as one player owns everything.
- **Fixed 6×6 board**, `CELL = 68`px → a 408×408 canvas, consistent with the
  fixed-size boards used by the other games in this repo.
