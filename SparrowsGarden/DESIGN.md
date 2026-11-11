# Sparrow's Garden — design notes

*"Are not two sparrows sold for a penny? Yet not one of them will fall to the
ground outside your Father's care." — Matthew 10:29*

## Game concept

A maze **dot-muncher** on an HTML5 canvas. You are a sparrow hopping along the
gravel paths of a walled kitchen garden, pecking up every scattered seed. Four
garden cats prowl the same paths looking for you. Peck one of the four
**sunflower heads** in the corners and the cats turn shy for a few seconds —
chase them and they scamper home to the shed. Clear every seed in the garden
and a fresh, faster garden is laid out.

This is the maze-chase shape the collection was missing: the repository already
has maze *shooters* (Berzerk), maze *drivers* (Rally-X), block-pushing mazes
(Pengo, Ark Loading) and a snake (Lost Sheep), but no seed-collecting maze
chase.

Nothing is harmed in the garden: cats that catch the sparrow simply startle it
home (a life), and shy cats that the sparrow reaches run back to the shed. The
theme is the goodness of creation and God's care for the smallest bird.

## Board

A hand-drawn 19 × 21 grid of 24 px cells (canvas 456 × 504), stored as a string
array in `MAZE_SRC` and compiled into a numeric `grid`:

| Tile | Value | Meaning |
|---|---|---|
| `WALL` | 0 | hedge / garden wall |
| `PATH` | 1 | open gravel, nothing on it |
| `SEED` | 2 | a seed worth 10 |
| `SUNFLOWER` | 3 | a sunflower head worth 50, turns the cats shy |

`B` in the source marks the bare patch of earth in the middle where a berry
ripens, so the berry never shares a cell with a seed.

The layout is left–right symmetric, has no dead ends, and every open cell is
reachable from the sparrow's start cell — all three are asserted by tests. A
fresh garden holds **201 seeds and 4 sunflowers (205 to clear)**.

`S` in the source marks the sparrow's start cell (row 19, col 9) and the four
`C` cells (row 9, cols 6/8/10/12) are the cats' shed. None of those cells, nor
the berry patch at row 11 col 9, carries a seed.

## Movement model

Logic is **cell-stepping**, rendering is smooth. Every mover is
`{ r, c, dir, prog }` where `prog` is 0…1 of the way into the cell it is
heading for, so its continuous position is `c + dir.dc * prog`. `advance(m,
speed, dt)` walks the mover forward `speed * dt / 1000` cells, re-deciding the
direction each time it lands exactly on a cell (`prog === 0`). Cell-aligned
decisions keep the game deterministic and let the tests step time by hand.

* **Sparrow**: a key press sets `want`; at each cell the sparrow takes `want` if
  that way is open, else carries on in `dir`, else stops. So you can turn early
  and the turn is taken at the next corner.
* **Cats**: at each cell a cat scores every open neighbour except a reversal
  (reversing is allowed only when there is no other way) by squared distance to
  its current target, and takes the best; ties break up, left, down, right.

Collision is measured in continuous coordinates — a cat catches the sparrow when
it is within half a cell on both axes — so the two cannot slip through each
other mid-corridor.

## Cat modes

| Mode | Behaviour |
|---|---|
| `scatter` | heads for its own corner of the garden |
| `chase` | heads for its target cell (below) |
| `shy` | runs for the neighbour *furthest* from the sparrow, at half speed |
| `home` | sitting in the shed for `HOME_MS`, harmless and still |

Targets, in the spirit of the arcade original: **Tabby** aims at the sparrow's
cell; **Ginger** four cells ahead of it; **Smoke** at the cell two ahead of the
sparrow reflected through Tabby; **Snowy** chases only inside eight cells and
otherwise returns to her corner.

The mode schedule runs per garden — scatter 5 s → chase 20 s → scatter 5 s →
chase for the rest of it. Losing a life re-places everybody but does not rewind
that schedule, so a death cannot be used to farm a fresh scatter. Eating a sunflower turns every cat that is not `home` shy
for `SUNFLOWER_MS` (7 s at level 1, 800 ms less per level, floor 2.5 s) and
resets the shoo chain, which pays 200, 400, 800, 1600.

## Scoring

Seed 10 · sunflower 50 · shooed cat 200 doubling · berry 100. A berry appears on the bare
patch at row 11 col 9 once 60 seeds have gone in a garden and stays for 8 s. Clearing a
garden keeps the score and raises the level: cats gain 0.4 cells/s per level
(capped at 6.5) while the sparrow stays at 5. Three lives; the best score is
kept in `localStorage` under `sparrows-garden-best`.

## Controls

| Input | Action |
|---|---|
| Arrow keys / **W A S D** | Hop up, left, down, right |
| Swipe on the canvas | Hop that way (touch screens) |
| **P** | Pause / resume |
| Any direction key, a swipe, **Space**/**Enter**, or **Start** | Begin play |

A swipe shorter than 18 px counts as a tap and is ignored; longer ones take
whichever axis moved further. `swipe(dx, dy)` is its own function so the tests
drive it without synthesising touches, and the touch listeners only translate
events into a call to it.

## Code shape

One classic (non-module) script, `game.js`, exactly like the other games here,
so the Playwright suite can read and poke the globals (`grid`, `player`, `cats`,
`score`, `lives`, `level`, `state`, `seedsLeft`) and call the seams
(`startGame()`, `stopLoop()`, `tick(dt)`, `advance()`, `chooseCatDir()`,
`catTarget()`, `openAt()`, `swipe()`). `requestAnimationFrame` only ever calls `tick(dt)`,
so tests call `stopLoop()` and then step time themselves.

* `index.html` — HUD, canvas, overlay, rules.
* `style.css` — garden palette, no framework.
* `game.js` — maze compilation, movement, cat AI, scoring, rendering.
* `tests/sparrows-garden.spec.js` — the Playwright suite, written first.

## Assumptions

Decisions taken without being able to ask, per the simpler-interpretation rule:

1. **Branch name.** The task asks for a branch named after the game
   (`sparrows-garden`), but this session's standing instructions pin all work to
   the branch `claude/compassionate-ramanujan-j8t1rz` and forbid pushing
   anywhere else. The designated branch wins; the game folder carries the name
   instead.
2. **No wrap-around tunnels.** The classic side tunnels are left out so the
   maze is a closed garden — fewer edge cases, and the walls are part of the
   theme.
3. **No shed door logic.** Cats start on four open path cells in the middle of
   the garden rather than inside a box with a one-way door, and a shooed cat is
   simply parked there for 3 s. This drops a whole state machine for no loss in
   play.
4. **Death is instant.** Losing a life re-places the sparrow and the cats
   straight away instead of playing a death animation, so time never has to be
   "frozen" mid-frame.
5. **Shy cats flee by maximum distance**, not pseudo-randomly as in the
   original, keeping the AI one deterministic function.
6. **One fixed berry cell and threshold** (row 11 col 9, after 60 seeds) rather
   than a per-level fruit table. That cell is laid out bare, so collecting a
   berry can never be confused with collecting the seed under it.
7. **Cats are never hurt and never hurt the sparrow** — "caught" costs a life
   and "shooed" sends a cat home, which keeps the game inside the repository's
   content policy.
