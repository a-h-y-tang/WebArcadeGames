# Stones of Remembrance — design notes

## Concept

A push-only block puzzle (the Sokoban family) themed on Joshua 4: Israel crosses
the Jordan on dry ground, and twelve men carry stones out of the riverbed to set
up as a memorial at Gilgal. The player is a bearer in the dry bed; the stones are
the memorial stones; the goal squares are the places at Gilgal where they are to
be set up; the walls are the banks of the river.

The theme changes names, art and story text only. The rules are the classic
ones, unchanged.

## Mechanics

The board is a rectangular grid. Each square is bank (wall) or dry bed (floor);
a floor square may also be a **memorial place**, and may hold a **stone** or the
**bearer**.

A step in direction `(dr, dc)`:

1. If the target square is off the board or is bank, nothing happens — `blocked`.
2. If the target square holds a stone, look one square further on. If *that*
   square is off the board, bank, or holds another stone, nothing happens —
   `blocked`. Otherwise the stone moves there, the bearer takes its square, and
   the step counts as a `push`.
3. Otherwise the bearer simply moves — a `walk`.

Steps and pushes are counted separately, the way Sokoban scores are usually
quoted. A crossing is finished when every stone stands on a memorial place.

Because a stone can only be pushed, a stone shoved into a square with walls on
two perpendicular sides can never move again. `isDeadCell(r, c)` recognises
those squares (a memorial place is never one — a stone there is home, not lost),
and `stuckStones()` lists the stones standing on one. The game outlines such a
stone in red and says so in the status line rather than letting the player grind
on in a position that cannot be finished.

Every step is pushed onto `undoStack` as `{ r, c, dr, dc, pushed, facing }`,
which is all that is needed to reverse it: put the bearer back, and if the step
was a push, drag the stone from in front of the bearer back onto the bearer's
square. Undo therefore costs nothing to store and unwinds a whole crossing.

## Controls

| Input | Action |
|---|---|
| Arrow keys / WASD | Step, pushing whatever is in front of the bearer |
| Click a square | Step one square towards it, if it shares the bearer's row or column |
| U / Undo | Take back one step |
| R / Reset | Reload the crossing in play |
| N / Next Crossing | Advance, once the crossing is finished |

Clicking is there so the game works on a touch screen without an on-screen
D-pad. A click only ever moves the bearer one square, so it cannot skip past a
stone by accident; a diagonal click does nothing.

## Levels

Levels are hand-built maps in the usual Sokoban notation (`#` bank, space dry
bed, `$` stone, `.` memorial place, `*` stone on a place, `@` bearer, `+` bearer
on a place), parsed into grids by `parseMap`. Keeping them as text makes them
easy to read, easy to edit, and easy for the test suite to check independently of
the running game.

The five crossings need 5, 6, 11, 19 and 25 pushes at best — a deliberate climb,
which a test enforces so a later edit cannot quietly flatten the difficulty curve.

## Code layout

A single classic (non-module) script, as with the other puzzle games here, so the
rule functions and board state are plain globals the Playwright suite can read:

- `parseMap(map)` — map text to `{ rows, cols, walls, goals, stones, player }`.
- `step(dr, dc)` / `undoMove()` / `resetLevel()` / `nextLevel()` — the moves.
- `isDeadCell(r, c)` / `stuckStones()` / `isSolved()` / `stonesHome()` — pure
  questions about the position, with no side effects.
- `loadLevel(i)` — install a level, size the board to the canvas, reset counters.
- `afterMove()` — the one place that recomputes solved/stuck state, updates the
  HUD, the status line and the overlay, and redraws.
- `draw()` and its helpers — bank, bed, memorial place, stone, bearer.

Routing every change through `afterMove()` means the screen cannot drift out of
step with the board: whether a square changed because of a key, a click, an undo
or a level load, the same code recomputes everything that is displayed.

Rendering is plain canvas 2D. The board is scaled to fit whichever level is
loaded (`cellSize` is capped at 60px so the small crossings are not blown up) and
centred, so one fixed 560×460 canvas serves maps from 9×7 up to 11×9. The grit on
the riverbed comes from a small seeded generator keyed on the square and the
level, so a square looks the same every time it is drawn.

## Testing

Tests were written before the game and drove the implementation. They cover the
initial position, walking, pushing, blocked pushes, undo, reset, the solved
overlay, level selection, the wedged-stone warning, click control and the theme.

The interesting ones are about the level data. The suite carries its own Sokoban
solver, written from the map text alone and sharing no code with the game, and
uses it to prove that every crossing can actually be finished. It searches
breadth-first over *pushes* rather than steps: a state is the set of stone
squares plus the region the bearer can walk in, named by its smallest square, so
two positions that differ only in where the bearer stands inside one region count
as one. Stones pushed into a dead corner are pruned. That keeps the hardest level
to about two seconds, where a naive search over single steps did not finish at
all.

The suite also checks that every map is rectangular and walled all the way round,
that stones and memorial places come in equal numbers, that no stone starts
wedged, and that the push counts climb from level to level.

## Assumptions

Decisions made where the brief was open, noted here as asked:

- **The branch.** The task asked for a branch named after the game
  (`stones-of-remembrance`), but this session's standing instructions name
  `claude/compassionate-ramanujan-2dtncl` as the branch to develop and push to,
  and say never to push elsewhere without permission. The standing instruction
  wins; the work is on that branch, as with the other games in this repo.
- **Five levels, not twelve.** Joshua 4 has twelve stones, which would make a
  single enormous puzzle. Five crossings of two to four stones each give a
  playable difficulty curve instead, and the story is told in the level names —
  the riverbed, the dry ground, the crossing, Gilgal, the memorial.
- **No timer and no score beyond steps and pushes.** This is a thinking puzzle;
  a clock would fight the theme and the genre. Steps and pushes are shown so a
  player can try to beat their own line.
- **A wedged stone warns rather than ends the run.** Formally the position is
  lost, but ending a quiet puzzle abruptly is unkind. The game names the problem
  and points at Undo.
- **Movement is ignored once a crossing is solved**, so the overlay cannot be
  walked out from under. Undo and Reset still work, which un-solves the board.
- **Click control steps one square at a time** rather than pathfinding to the
  clicked square: simpler to reason about, and it cannot wreck a position with a
  long unintended walk.
