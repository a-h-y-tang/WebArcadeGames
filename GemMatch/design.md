# Gem Match — Design Document

> This is the design document requested by the task (which refers to it as
> `DESIGN.md`). It is named `design.md` to match the repository convention —
> the root `README.md` states *"Each game should include a design.md"*, and every
> existing game uses that lowercase name. See **Assumptions**.

## Game Concept

**Gem Match** is a Bejeweled-style match-three puzzle. An 8×8 board is filled
with six colours of gems. You **swap two adjacent gems** to line up three or more
of the same colour; matched gems clear, the gems above **fall down** to fill the
gaps, and fresh gems drop in from the top. Chains of clears (**cascades**) score
progressively more. You have a fixed budget of **25 moves** — spend them to build
the highest score you can. Your best score is saved between sessions.

The existing arcade has action games (Snake, Space Invaders, Asteroids, …) and a
couple of grid puzzles (2048, Minesweeper). Gem Match adds the one classic
puzzle mechanic none of them use: **swap-to-match with gravity and cascades**. It
is genuinely distinct — 2048 slides and merges a sparse grid, Minesweeper reveals
a static grid, and Gem Match continuously clears-and-refills a full grid.

## Mechanics

- **The board.** An 8×8 grid, every cell holding one of six gem colours. The
  starting board is generated so it contains **no pre-made matches** and always
  has **at least one legal move**.
- **Swapping.** Select a gem, then select an orthogonally-adjacent gem to swap
  them. The swap is only kept if it forms a match of three-or-more; otherwise the
  two gems snap back and **no move is spent**. Diagonal or distant pairs are
  rejected outright.
- **Matching.** Any horizontal or vertical run of three-or-more same-coloured
  gems is a match. A single swap can complete several runs at once (e.g. an
  L/T shape), and every gem in every run clears together.
- **Gravity & refill.** After a clear, surviving gems in each column **fall to
  the bottom**, then the empty cells at the top **refill** with new gems.
- **Cascades.** If the settled/refilled board contains new matches, they clear
  too — automatically, in a loop — until the board is stable. Each successive
  cascade step multiplies the points its clear is worth, so setting up a chain is
  the way to a big score.
- **Refill is fair.** Newly dropped-in gems never form a match on arrival, so
  cascades come from *your* gems settling into place, not from lucky refills.
  This also makes scoring deterministic and cleanly testable.
- **Scoring.** Each cleared gem is worth `10 × cascade-depth` points, so bigger
  matches and longer chains score more.
- **The clock is moves.** The game ends after 25 moves; the goal is the highest
  score in that budget. If the board ever runs out of legal moves it is
  reshuffled (kept full and match-free) so you are never stuck.
- **Best score.** The highest score achieved is persisted to `localStorage` and
  shown in the HUD.

## Controls

| Input | Action |
|---|---|
| Click a gem | Select it (click it again to deselect) |
| Click an adjacent gem | Swap the two |
| Arrow keys | Move the keyboard cursor |
| Space / Enter | Select the cursor's gem, then a neighbour to swap |
| Button | Start / restart |

## Architecture

A single static page — `index.html`, `style.css`, `game.js` — with no build step
or dependencies. Open `index.html` directly in a browser.

### Data model

The board is `grid[r][c]`, an 8×8 array of gem-type integers `0…5`, with the
sentinel `EMPTY` (`-1`) for a momentarily-empty cell during resolution. All board
logic is expressed as small pure functions over `grid`, which is exactly what
makes the game testable without any reliance on animation or wall-clock timing:

- **`findMatches()`** → a `Set` of `"r,c"` keys for every gem in a run of 3+.
- **`isAdjacent(a, b)`** → orthogonal-neighbour test.
- **`collapseColumns()`** → gravity: slide non-empty gems to the bottom of each
  column, leaving `EMPTY` at the top.
- **`refill()`** → fill every `EMPTY` cell, never creating an immediate match.
- **`resolveBoard()`** → the cascade loop: while there are matches, score them,
  clear them, collapse and refill; returns when the board is stable.
- **`trySwap(a, b)`** → the one entry point for a move: reject non-adjacent
  pairs, swap, and if it made no match, revert (no move spent); otherwise spend a
  move, resolve cascades, and end the game if the move budget is exhausted.
- **`hasAvailableMove()`** → is any legal (match-making) swap available?

Because `trySwap` and friends read and mutate `grid` synchronously, a test can
inject an exact board, call `trySwap`, and assert on the result deterministically.

### Determinism & randomness

New gems come from a small seeded PRNG (`mulberry32`). Tests never depend on the
random values: they set the board explicitly and assert on structural outcomes
(matches found, board stays full, score rises, game ends). Refill's
no-immediate-match rule removes randomness from scoring for a controlled board.

### State machine

`state` is `idle → running → over → running`, mirroring the other games. The
overlay is shown for every non-`running` state (start screen and game-over).

### Rendering

Each frame is drawn from the model: a rounded gem per cell in its colour, a
highlighted ring on the selected gem, and a subtle cursor outline for keyboard
play. Rendering is a pure function of `grid` + selection, so `render()` can be
called directly (the tests do, after injecting a board).

## Assumptions

- **Design-doc filename.** The task says "DESIGN.md"; the repo convention (and the
  root README's explicit requirement) is `design.md`. I used `design.md` for
  consistency. It covers the requested sections: concept, mechanics, controls,
  assumptions.
- **Move budget, not a timer.** A real-time countdown is hard to test
  deterministically and adds nothing the puzzle needs. A fixed 25-move budget
  gives a clean, testable end condition; exposed as `MAX_MOVES`.
- **Refilled gems never auto-match.** A deliberate design choice that keeps
  cascades skill-driven and makes scoring reproducible. Some match-3 games allow
  refill matches; the simpler, fairer interpretation is chosen here.
- **Points = `10 × cascade-depth` per gem.** A simple rule where larger matches
  and longer chains clearly score more; exposed as `BASE_POINTS`.
- **Board 8×8, six colours, 60px cells → 480×480.** Comparable to the other
  games' canvases and giving enough room for interesting cascades; exposed as
  `SIZE`, `GEM_TYPES`, `CELL`.
- **Single, self-contained page** with no dependencies, like every other game.
