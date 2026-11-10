# Land of Inheritance — design

## Concept

A rectangle-partition logic puzzle themed on the division of Canaan among the
tribes of Israel (Joshua 14–19; the lots cast at Shiloh in Joshua 18:10). The
board is a stretch of land; each numbered **boundary stone** stands in the field
of one tribe, and the number is the size of that field. The player marks out
every field until the whole land is divided and nothing is left over.

The ruleset is the "Shikaku" family of pencil puzzles. Nothing in the
repository uses it: the closest neighbours are Nonogram (edge counts), Hitori
(shading) and Flow (paths), and none of them ask the player to *partition* a
grid. The novelty here is the shape of the deduction — every square belongs to
exactly one rectangle, so each field you fix squeezes the ones around it.

## Mechanics

A land is a square grid holding:

- **boundary stones** — fixed, one per field, numbered with that field's area;
- **fields** — axis-aligned rectangles the player marks out.

The land is divided when all of the following hold:

1. every square belongs to a field;
2. no two fields overlap;
3. every field holds exactly one boundary stone;
4. every field's area equals the number on its stone.

Rules 2 and 3 are enforced as you play: a drag that overlaps a field already
marked out, or that takes in no stone or two stones, is refused with a reason.
A field of the *wrong size* is allowed to stand — that is how a player tests an
idea — but it is drawn in dashed red and does not count towards the tally.
Because every field holds exactly one stone and fields cannot overlap, "every
square claimed, every field exact" is enough to know the land is divided.

### Levels

| Land | Grid | Largest field | Typical fields |
|---|---|---|---|
| Hill country | 7 × 7 | 6 | ~10 |
| Shephelah | 9 × 9 | 8 | ~17 |
| Beyond Jordan | 11 × 11 | 9 | ~25 |

## Controls

| Action | Mouse | Keyboard |
|---|---|---|
| Mark out a field | drag corner to corner | **Space** on one corner, move, **Space** on the other |
| Cancel a half-made field | release on the starting square | **Esc** |
| Clear a field | click or right-click inside it | **Backspace** / **Delete** |
| Move | — | **arrow keys** or **WASD** |
| Hint / New land / Reset | buttons | **H** / **N** / **R** |

While a field is being dragged the preview shows its running square count and
turns green when it matches the stone it holds, amber when it is legal but the
wrong size, and red when it would be refused.

## Generating a land

`buildPuzzle(cols, rows, maxArea, seed)` is pure and deterministic — the same
seed always yields the same land, which is what lets the Playwright suite make
firm assertions about generated puzzles.

1. **Cut the land.** `splitRect` recursively bisects the grid. Only cuts that
   leave both halves at least two squares are considered, so no field is ever a
   single square (which would give itself away). Pieces at least ~60% of the
   maximum size are usually kept; smaller ones are usually cut again, and cuts
   that leave two useful pieces are preferred over ones that shave off a sliver.
2. **Keep the roomiest cut.** Random bisection strands a lot of two-square
   slivers, which make a dull puzzle, so 64 lands are cut and sorted by fewest
   fields, then fewest two-square fields.
3. **Drop the stones.** `placeStones` puts one stone on a random square of each
   field and names the field after a tribe.
4. **Insist on one answer.** `countSolutions` counts the lawful divisions, up to
   a limit. Candidates are tried best-first, with a few different stone
   placements each, and the first land that can be divided in exactly **one**
   way is the puzzle. Across all three levels every seed tested produces a
   uniquely solvable land in a few milliseconds.

`countSolutions` is a small backtracking search: for each stone it enumerates
every rectangle of the right area that holds that stone and no other
(`rectOptionsFor`), then repeatedly places the stone with the fewest remaining
choices. That ordering keeps the search tiny — a 11 × 11 land resolves in ~4 ms.

## Code tour

`game.js` is one classic (non-module) script, like the other puzzle games here,
so its pure functions and board state are plain globals the Playwright suite can
reach through `page.evaluate`.

### Pure rules

| Function | Purpose |
|---|---|
| `makeRng(seed)` | mulberry32 PRNG, so a seed always builds the same land |
| `normalizeRect(r1, c1, r2, c2)` | reads a drag in any direction as one rectangle |
| `rectsOverlap(a, b)` / `rectContains` | geometry used by the rules and the renderer |
| `cluesInRect(rect)` | the boundary stones a rectangle takes in |
| `isExact(rect)` | one stone, and the area it asks for |
| `splitRect` / `generatePartition` | cuts a grid into legal fields |
| `rectOptionsFor(clue, …)` | every field a given stone could own |
| `countSolutions(puzzle, limit)` | how many lawful divisions a land has |
| `buildPuzzle(…)` | a uniquely solvable land for a seed |
| `isSolved()` | every square claimed and every field exact |

### Board state

`puzzle` holds the generated land (`solution`, `clues`); `regions` holds the
player's fields; `cursor` and `anchor` hold the keyboard cursor and its pinned
corner; `dragStart` / `dragEnd` hold a mouse drag in progress. `addRegion`,
`removeRegionAt` and `hint` are the only things that change `regions`, and each
ends in `finishMove`, which checks for a win, updates the HUD and redraws.

### Rendering

`draw()` paints in layers: ground, the player's fields, the grid, the drag
preview, the boundary stones, then the keyboard cursor. Stones are drawn last so
a field can never hide one, and a tribe's name is placed by `labelSpot` in the
lowest row of its field that the stone does not occupy (or beside the stone in a
one-row field), so the two never collide.

Pointer moves and releases are handled on `window`, not the canvas, so a drag
that leaves the board still finishes; the coordinates are clamped back onto the
land.

## Assumptions

Made while building this, in the absence of anyone to ask:

- **Branch name.** The task asked for a branch named after the game
  (`land-of-inheritance`), but the session's standing instructions pin all work
  to `claude/compassionate-ramanujan-uy6ska`. The standing instruction wins; the
  game's name lives in the folder instead.
- **Wrong-sized fields are allowed to stand.** Refusing them outright would be
  simpler, but marking a field and *then* seeing it is one square short is how
  this puzzle is normally played, so a wrong field is kept and drawn in red.
- **Any lawful division wins**, not only the generated one. Lands are generated
  so that there is exactly one, so in practice the two are the same thing.
- **No timer and no score.** The repo's other logic puzzles count what matters
  (fields placed, land claimed, hints used) rather than racing the player, and a
  clock would push the player away from careful deduction.
- **Three fixed levels** rather than an endless difficulty curve: it matches
  the other puzzles here and keeps a game short enough to finish in a sitting.
- **Minimum field size is two squares.** One-square fields are legal Shikaku but
  they solve themselves, so the generator never makes one.
