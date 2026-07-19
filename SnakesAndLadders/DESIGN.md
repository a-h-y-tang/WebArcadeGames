# Snakes and Ladders — Design

## Game concept

The classic race-to-100 board game on an HTML5 canvas. You (a blue token)
race a computer opponent (a red token) up a 10×10 boustrophedon board
numbered 1–100. Roll a die, advance, and hope to land on the foot of a
**ladder** (climb up) while dodging the head of a **snake** (slide down).
First token to land *exactly* on square 100 wins.

It is a game of pure luck — no decisions — which makes it a compact,
self-contained showcase of clean, fully deterministic game logic that the
Playwright suite can drive without any randomness or timing dependence.

## Mechanics

- **Board:** squares 1–100 in boustrophedon ("ox-turning") order — square 1
  is bottom-left, the first row runs left→right, the next row right→left,
  and so on up to square 100 at the top-left.
- **Turn:** the current player rolls one six-sided die and advances that
  many squares from their current position (both players start on square 0,
  just off the board).
- **Overshoot rule:** you must land *exactly* on 100. If a roll would take
  you past 100 you don't move at all and forfeit the turn.
- **Ladders** (foot → top) move you *up*; **snakes** (head → tail) move you
  *down*. A jump is applied once, on the square you land on.
- **Win:** landing exactly on square 100 wins immediately.
- Play alternates You → Computer → You … The computer plays automatically
  after a short delay.

### Board layout (standard Milton-Bradley)

Ladders: 1→38, 4→14, 9→31, 21→42, 28→84, 36→44, 51→67, 71→91, 80→100.

Snakes: 16→6, 47→26, 49→11, 56→53, 62→19, 64→60, 87→24, 93→73, 95→75,
98→78.

## Controls

- **Roll** button, or **Space** / **Enter** — roll the die on your turn.
- The computer takes its own turn automatically.
- After the game ends, the same button / keys start a new game.

The number of games you have won is persisted in `localStorage` under
`snakes-and-ladders-wins` and shown as "Best".

## Code structure

`game.js` is a single classic (non-module) script so its state and logic
are reachable as plain globals from Playwright's `page.evaluate`, matching
the repo's other games.

- **Pure logic (unit-testable, no DOM):**
  - `LADDERS`, `SNAKES` — the board maps; `JUMPS` merges both.
  - `applyJump(pos)` → the square you end on after any ladder/snake on
    `pos` (returns `pos` unchanged if there is none).
  - `computeMove(pos, roll)` → the final square after moving `roll` from
    `pos`, encoding the exact-landing overshoot rule and the jump.
- **Game state:** `positions` (`[you, cpu]`), `currentPlayer` (0/1),
  `phase` (`idle` | `playing` | `over`), `winner` (`null` | 0 | 1),
  `lastRoll`.
- **Flow:** `rollDie()`, `takeTurn()` (one full turn for the current
  player — roll, move, resolve, check win, switch), `startGame()`.
- **Determinism seam for tests:** a global `forcedRolls` queue; when
  non-empty, `rollDie()` shifts the next value from it instead of using
  `Math.random`, letting tests script exact games.
- **Rendering:** `draw()` paints the board, square numbers, ladders (lines)
  and snakes (curves), and both tokens, offset so they never fully overlap.

## Assumptions

Following the "pick the simpler interpretation" guidance:

- **Two players only:** one human vs one computer (no 3–4 player mode).
- **No bonus turn on a six** — rolling a 6 does not grant a re-roll; every
  turn is exactly one roll. This keeps turn flow trivially deterministic.
- **Single jump per landing** — the standard board never chains a ladder
  into a snake, so `applyJump` resolves only the square landed on.
- The computer has no strategy to apply (the game has no choices); it simply
  rolls, so "AI" is just an automatic roll on its turn.
- "Best" tracks total games won, since a single match has no numeric score.
- Canvas is a fixed 500×500 board scaled by CSS; no responsive re-layout
  beyond CSS scaling.
