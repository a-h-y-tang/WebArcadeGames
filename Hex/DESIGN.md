# Hex — Design

## Game concept

Hex is the classic two-player connection game, invented independently by Piet
Hein (1942) and John Nash (1948). It is played on a rhombus-shaped board of
hexagonal cells — here **11×11**, the tournament standard. The two players own
opposite pairs of edges:

- **Red** owns the **top** and **bottom** edges and wins by building an unbroken
  chain of red stones linking top to bottom.
- **Blue** owns the **left** and **right** edges and wins by building an unbroken
  chain of blue stones linking left to right.

Players alternate placing one stone of their colour on any empty cell. A famous
theorem (Hex can never end in a draw) guarantees that once the board fills, one
— and exactly one — player has a winning connection. In practice a game ends the
moment a connection is completed, usually long before the board is full.

Everything is drawn with the HTML5 Canvas 2D API: a honeycomb of pointy-top
hexagons with red/blue edge borders and glossy stones.

## Mechanics

- **Placing a stone** — click any empty cell. The current player's stone is
  placed there and the turn passes to the other player.
- **Adjacency** — each interior cell has **six** neighbours. Using rhombus/axial
  coordinates `(r, c)` (row, column) the neighbours are:

  ```
  (r,   c-1)  (r,   c+1)
  (r-1, c)    (r+1, c)
  (r-1, c+1)  (r+1, c-1)
  ```

  The two extra diagonal links (up-right and down-left) are what make the grid a
  true hex lattice rather than a square one.
- **Winning** — after each move the mover's colour is flood-filled from its
  starting edge. Red wins if the fill starting from **row 0** reaches **row
  N-1**; Blue wins if the fill starting from **column 0** reaches **column N-1**.
  The check only ever runs for the player who just moved, so only that player can
  win on their own turn.
- **No draws** — the board can always be resolved; if it somehow filled without a
  detected win the game simply keeps waiting, but by the Hex theorem this cannot
  happen.
- **Swap rule (pie rule)** — offered on Red's very first move only. Because moving
  first is a strong advantage, after Red places the opening stone Blue may
  **swap** — taking over that stone as their own — instead of replying. This is
  the standard balancing rule. Swapping is optional; Blue can also just play a
  normal move.

## Deterministic core (for testing)

All state lives on the global scope as plain values so the Playwright suite can
read and build exact positions with no timing dependence:

- `board` — an `N×N` array of `0` (empty), `1` (red) or `2` (blue).
- `current` — whose turn it is (`1` or `2`).
- `state` — `'idle'`, `'playing'`, `'won'` or `'swap'` (waiting for Blue's
  swap/play decision).
- `winner` — `0` while unresolved, otherwise `1` or `2`.
- `moveCount` — stones placed so far.

The rules are small pure functions kept separate from rendering:

- `neighbors(r, c)` — the up-to-six in-bounds neighbours of a cell.
- `place(r, c)` — the player action: drop a stone, run win detection, flip the
  turn (or resolve the game).
- `connects(player)` — flood fill; `true` when `player` links their two edges.
- `checkWin()` — resolve `state`/`winner` from the board.
- `reset()` — clear the board to an empty `state === 'playing'` position.

Because these are pure and all state is global, a test can assign an exact
`board`, call `connects(1)`, and assert the result instantly — Hex has no
animation-driven logic.

## Rendering & input

- Pointy-top hexagons are laid out with the standard axial→pixel transform:
  `x = size·√3·(c + r/2)`, `y = size·1.5·r`. Row 0 is the top; each lower row is
  shifted half a hex to the right, forming the rhombus.
- A click is mapped to a cell by finding the hex **centre nearest** the click
  point (121 cells — a trivial linear scan) and rejecting clicks that land
  outside every hex. This is robust and, unlike pointy-hex point-in-polygon
  math, easy to reason about in tests.
- The four board edges are painted red (top/bottom) and blue (left/right) so each
  player can see the sides they must connect.

## Controls

| Action                     | Input                                   |
|----------------------------|-----------------------------------------|
| Place a stone              | Click / tap an empty cell               |
| Swap (pie rule)            | **Swap** button, shown only to Blue after Red's first move |
| New game                   | **R**, or the on-screen button          |
| Start / play again         | Click the button, or any key            |

## Assumptions

- **Novel game** — the repository and every open pull request already cover a
  large catalogue (Snake, 2048, Tetris, Reversi, Connect Four, Gomoku, Nine
  Men's Morris, Mastermind, Checkers, Flood It, and dozens more). Hex — a
  *connection* game where you build a path rather than align or capture pieces —
  is distinct from all of them, including the other board games.
- **Two-player hotseat** — following the "simpler interpretation" guidance, Hex
  ships as a local two-player game (share one screen/mouse) rather than with a
  computer opponent. A strong Hex AI is a substantial undertaking; hotseat keeps
  the rules crisp and every outcome fully deterministic for testing. Reversi in
  this repo has an AI; Hex deliberately does not.
- **11×11 board** — the tournament-standard size. Fixed dimensions and a fixed
  canvas keep the click→cell mapping deterministic, matching the fixed-size
  approach of the other games.
- **Pie/swap rule included** because without it the first player wins with perfect
  play; it is the universally accepted fix and is cheap to implement. It is
  offered only on Blue's first reply.
- Click mapping uses nearest-centre selection (with an out-of-bounds guard)
  rather than exact hexagon point-in-polygon testing — simpler, and
  indistinguishable to the player for clicks anywhere reasonable inside a cell.
- The orphan `GeoDash/` HTML file in the repo root is not listed in the README,
  has no tests and is not marked *In Progress*, so it is left untouched.
