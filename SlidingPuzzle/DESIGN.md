# Sliding Puzzle — Design Document

## Game Concept

The 15-puzzle: a 4×4 grid holds fifteen numbered tiles and one empty space.
Tiles adjacent to the gap can slide into it. By sliding tiles one at a time the
player rearranges a scrambled board back into numerical order (1–15 reading
left-to-right, top-to-bottom) with the empty space in the bottom-right corner.
The goal is to solve it in as few moves as possible.

## Board Model

The board is a flat array `tiles` of length `SIZE² ` (SIZE = 4, so 16 cells).
Each entry is the number printed on that cell; the value **0** represents the
empty space. A cell's grid position maps to the array index as
`index = row * SIZE + col`, so:

```
index:  0  1  2  3
        4  5  6  7
        8  9 10 11
       12 13 14 15
```

The **solved / goal** state is `[1, 2, …, 15, 0]` — the numbers in order with
the blank last. `isSolved()` is a straight array comparison against this goal.

## Moving Tiles

A single public function, `moveTile(index)`, drives all movement. It only does
something when the clicked/targeted tile shares a **row or column** with the
blank:

- **Same row or column** → every tile between the target and the blank slides
  one step toward the blank, and the blank ends up where the target was. This
  is the classic behaviour where clicking a tile three cells away from the gap
  slides all three tiles at once.
- **Otherwise** → no move.

Each successful `moveTile` call counts as **one move**, regardless of how many
tiles physically slid, so a move maps one-to-one to a player action.

Keyboard input is expressed in the same terms. An arrow key slides the single
tile neighbouring the blank in that direction into the gap:

| Key | Tile that slides |
|-----|------------------|
| ↑ / W | the tile **below** the blank moves up |
| ↓ / S | the tile **above** the blank moves down |
| ← / A | the tile to the **right** of the blank moves left |
| → / D | the tile to the **left** of the blank moves right |

(The arrow points in the direction the tile travels.) Internally each arrow
resolves to the neighbouring tile's index and calls `moveTile`, so keyboard and
click movement share exactly one code path.

## Shuffling (always solvable)

Only half of all tile permutations are reachable from the solved state, so a
naive random shuffle would sometimes produce an **unsolvable** board. To
guarantee solvability, `newGame()` starts from the solved board and applies a
few hundred random *legal slides*. Because every move is reversible, the result
is always solvable, and the loop keeps going until the board differs from the
goal so the player never starts on an already-solved puzzle.

## State Machine

`state` is either `playing` or `won`. Reaching the goal flips `state` to `won`,
shows the win overlay, and — if the solve used fewer moves than the stored
record — updates the best score.

## Rendering

A fixed **480×480** canvas divided into `SIZE×SIZE` cells (120 px each). Each
frame clears the canvas and draws every non-blank tile as a rounded rectangle
with its number centred. Tiles already sitting in their goal position are
tinted differently so progress is visible at a glance.

## Persistence

`localStorage` stores the best (fewest-move) solve under `sliding-puzzle-best`.
It is read on load and written only when a solve beats the stored value.

## Architecture

Three dependency-free files — `index.html`, `style.css`, `game.js` — matching
the other games in this repo. All logic lives in `game.js` as top-level state
and functions so Playwright can exercise the pure logic through `page.evaluate`
as well as via real clicks and key presses.

## Assumptions

- **Fixed 4×4 size.** A size selector (3×3 / 5×5) is a natural extension but the
  first version ships the canonical 15-puzzle only, keeping the UI and tests
  focused.
- **Moves count actions, not tiles.** A multi-tile row slide counts as one move,
  matching one click / one key press. This is the simpler, more intuitive
  interpretation for the player.
- **Numbers, not a picture.** Tiles show numbers rather than fragments of an
  image. Numbers make the goal state unambiguous and keep the game
  self-contained with no external assets.
- **Timer is out of scope.** Only move count and best-move record are tracked;
  a stopwatch would be a reasonable follow-up.
- **Shuffle uses `Math.random`.** Puzzles are not seeded/reproducible between
  sessions; tests that need a specific board set `tiles` directly rather than
  relying on the shuffle.
