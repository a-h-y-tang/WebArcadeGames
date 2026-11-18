# Dry Land — design

> "And God said, Let the waters under the heaven be gathered together unto one
> place, and let the dry land appear: and it was so." — Genesis 1:9

## Concept

A pencil-and-paper logic puzzle of the Nurikabe family, and the one classic logic
genre the collection did not have: the board is a map, the numbers stand on
pieces of dry land, and everything else is sea. The third day of creation gives
the rules their shape — the waters gathered into one place, the dry land
appearing — so the theme is the puzzle rather than a coat of paint over it.

## Mechanics

### The rules

A map is solved when all four hold:

1. Every piece of dry land holds **exactly one number**, and covers **exactly
   that many squares**.
2. Two pieces of land **never touch** side by side; they may meet only at a
   corner.
3. The sea is **one piece** — every square of sea joined to the rest.
4. The sea **never fills a square of four**; no 2x2 block is all sea.

Only the sea has to be marked to finish: a square left blank counts as dry land,
so the player can shade the water and stop. Marking land is there as a working
note, and the solver and hints use it the same way.

### Playing

* Click a square: sea → dry land → blank. Right-click runs the cycle the other
  way. Dragging paints the whole run the same way as the square it started on,
  and one drag is one undo step.
* The keyboard has a cursor: arrows move it, **Space** cycles, **S** and **L**
  set sea and land directly, **Backspace** clears. **H** hint, **C** check,
  **U** undo, **N** new map, **R** reset.
* Touch works the same way as the mouse, with a one-finger drag to shade.
* Three sizes: Small 7x7, Medium 9x9, Large 11x11. Each keeps its own best time
  in `localStorage` under `dry-land-best-<size>`.
* **Check** rings in red every mark that contradicts the answer, for four
  seconds. **Hint** fills in one square *and names the rule that settles it*.

## How a map is built

Everything happens in the page, in three passes, and a map is only accepted if it
survives all three.

1. **Grow a legal answer.** Start with nothing but sea. While some 2x2 block is
   all sea, turn one of its four squares into dry land — joining a neighbouring
   island if it touches exactly one, otherwise starting a new one — and keep the
   choice only if the sea is still in one piece. When no 2x2 block is left, the
   map obeys rules 2, 3 and 4 by construction. A short second pass takes a few
   more squares out of the sea, growing an island or joining two that sit one
   square apart, which trades a scatter of single squares for larger land; the
   sea only shrinks, so no 2x2 block can appear.
2. **Check that the answer is the only one.** Each number's island must be one of
   the polyominoes of its size that contain it, so `countSolutions` enumerates
   those shapes once per clue and fits them together by backtracking, cheapest
   clue first, pruning on overlap, on islands touching, and on any 2x2 block that
   no remaining island could still cover (the union of reachable squares per
   depth is precomputed as a suffix, so that prune is cheap). It stops at two
   solutions; a map with any other count is thrown away.
3. **Check that a person can solve it.** `logicSolve` applies only deductions a
   player can see:
   * a square that would join two numbers, or make an island bigger than its
     number, is sea;
   * an island that already has its number is finished, so the sea runs round it;
   * an unfinished island with one way to grow must grow that way;
   * a square no island can reach is sea (a budgeted flood fill per clue);
   * three corners of a square under water make the fourth dry;
   * a stretch of sea with one way out must take it, or it would be cut off;
   * land with no number yet must reach one.

   If those rules alone finish the map, it is accepted and the list of deductions
   is kept — that list is what **Hint** reads, which is why every hint can quote
   the rule it used. Generation is bounded in both tries and time, and relaxes
   its standards rather than hanging if a size ever proves stubborn.

Measured in the browser, over fourteen maps a size: 7x7 ~6ms a map, 9x9 ~65ms,
11x11 ~82ms, and every map solvable by the rules alone.

## Code layout

`game.js` is one classic script, no modules or build step:

1. **Geometry and sizes** — canvas, cell size, the three board sizes.
2. **State** — `clues`, `solution`, `grid`, `state`, clock, hints, history.
3. **Generation** — `generateSolution`, `cluesFor`, `newPuzzle`, `acceptPuzzle`.
4. **Solvers** — `polyominoes`, `islandShapes`, `countSolutions`, `logicSolve`.
5. **Play** — `mark`, `cycle`, `undo`, `reset`, `hint`, `check`, `isSolved`.
6. **HUD and overlay** — the counters, the clock, the status line.
7. **Input** — mouse (with drag painting), touch, keyboard, buttons.
8. **Drawing** — parchment, sea with ripples, clue stones, cursor, mistakes.

The solvers are exposed as globals, so the tests can ask the page itself whether
a map has one answer and whether the plain rules settle it.

## Testing

`tests/dry-land.spec.js` runs against `index.html` over `file://` — no server.
Its 57 tests were written before the game and cover the HUD and verse, the board
geometry at all three sizes, marking by click, right-click, drag, keyboard and the
counters, the four rules of the puzzle checked against generated answers,
single-answer and logic-solvable generation, hints, checking, undo, reset, new
map, the clock and best times, and the drawing.

Three of them are quality gates rather than unit tests, and they are the ones
that earned their keep:

* **the solution obeys every rule** — islands, sizes, one sea, no 2x2.
* **each map has exactly one answer** — `countSolutions` must return 1.
* **the rules never deduce a square wrongly** — every deduction of `logicSolve`,
  over ten generated maps across two sizes, is compared with the answer. This
  caught two unsound rules: "two pieces of land may not touch" fired when both
  neighbouring pieces were still unnumbered (they may legally join), and the
  reachability rule treated unnumbered land as a wall. Both would have handed the
  player wrong hints.

## Assumptions

Decisions taken without being able to ask, with the simpler reading chosen each
time:

* **Only the sea must be marked.** Requiring every land square to be marked as
  well is more typing for no more thinking, so blank counts as dry land.
* **Hints reveal one square**, correcting a wrong mark if there is one, and name
  the rule. They are counted and shown, so a player can judge their own run.
* **No difficulty setting** beyond board size: all maps are solvable by the plain
  rules, which keeps the promise on the page true.
* **Three sizes**, with 11x11 the largest, because generation stays under about a
  fifth of a second there and the board is still readable at 520 pixels.
* **Best time only**, no scoring: the puzzle has no score, and hints are reported
  next to the time rather than being penalised.
* **Branch.** The instructions ask for a branch named after the game; this
  session may only push `claude/compassionate-ramanujan-knt8k7`, so that is where
  the work is pushed.
