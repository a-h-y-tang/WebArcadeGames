# Prism Path — Design

Prism Path is a light-routing puzzle. A laser emitter fires a white beam into a
10x10 grid; the player rotates the mirrors scattered through the grid so that
the beam — split by prisms and tinted by colour filters along the way — reaches
every target in the colour that target demands.

## Concept

The board is static apart from the mirrors. Everything else (emitters, prisms,
filters, targets, walls) is fixed furniture, so a level is a pure routing
problem: there are `n` mirrors, each with two orientations, and the player is
looking for the combination that lights every target at once. Beams are
re-traced from scratch after each rotation, so the board is always showing the
truth — there is no hidden state and no timing element.

## Board pieces

| Piece | Level char | Behaviour |
|---|---|---|
| Empty | `.` | Beam passes through |
| Wall | `#` | Beam stops |
| Emitter | `>` `<` `^` `v` | Fires a white beam in that direction; opaque to other beams |
| Mirror | `/` `\` | Reflects 90°. **The only piece the player can change** — clicking flips it between `/` and `\` |
| Prism (splitter) | `(` = `/`, `)` = `\` | Reflects *and* passes the beam straight through — one beam in, two out |
| Filter | `r` `g` `b` `y` `c` `m` | Tints the beam (see colour model). A beam with nothing left after filtering dies here |
| Target | `R` `G` `B` `Y` `C` `M` `W` | Lights up when a beam of **exactly** its colour arrives; absorbs the beam either way |

### Colour model

Colours are 3-bit masks over red/green/blue:

```
R = 1   G = 2   B = 4
Y = R|G = 3     C = G|B = 6     M = R|B = 5     W = R|G|B = 7
```

An emitter fires white (`7`). A filter ANDs the beam's mask with its own, so a
white beam through a red filter becomes red, and a red beam through a blue
filter becomes nothing and stops. Targets match on mask equality, so a white
beam does *not* light a red target — the filter has to be in the path.

### Reflection

`/` is the bottom-left-to-top-right diagonal, `\` is top-left-to-bottom-right:

| Incoming | `/` | `\` |
|---|---|---|
| right | up | down |
| left | down | up |
| up | right | left |
| down | left | right |

## Beam tracing

`traceBeams()` is a breadth-first walk over beam states. Each state is
`(cell, direction, colour)`; the walk starts with one state per emitter and
stops a branch when it leaves the grid, hits an opaque piece, is filtered to
nothing, or revisits a state it has already produced. That last rule is what
makes mirror loops safe: a beam that circles back into a state already in the
visited set is simply dropped, so a ring of four mirrors terminates instead of
spinning forever. A hard iteration cap (`MAX_BEAM_STEPS`) is a second belt.

The walk emits a list of drawable segments (centre to centre, so a filter's
colour change happens visually at the filter) and sets `lit` on every target it
satisfies. `isSolved()` is then just "every target is lit".

## Scoring

Each level has a **par** — the number of rotations in the intended solution.
Solving a level pays `100 + 25 × max(0, par − moves)`, so an efficient solve is
worth more but a messy one still progresses. There is no fail state and no
timer: this is a puzzle, not a reflex game. The best total across a full six
level run is kept in `localStorage` under `prismpath-best`.

## Controls

| Input | Action |
|---|---|
| Mouse move | Moves the cursor to the cell under the pointer |
| Click a mirror | Flips it (counts as a move) |
| Arrow keys / WASD | Move the cursor |
| Space / Enter | Flip the mirror under the cursor |
| Space / Enter / click | Start the game, or advance from a cleared level |
| R | Restart the current level (mirrors and move count reset) |
| N | Next level once the current one is cleared |

## Levels

Six hand-built levels introduce one idea at a time: a single mirror, then a
filter, then a prism, then a prism feeding two colours, then a second emitter,
then everything at once. Every level ships as an array of ten ten-character
strings plus a name and a par.

The Playwright suite brute-forces all `2^n` mirror combinations for every level
and asserts both that a solution exists and that the shipped starting
arrangement is *not* already one — so a level can never be published broken or
pre-solved.

## Code layout

- `index.html` — HUD, canvas, overlay, help text
- `style.css` — dark neon-on-slate theme shared in spirit with the other games
- `game.js` — constants, level data, grid parsing, beam tracer, input, renderer
- `tests/prism-path.spec.js` — the Playwright suite

Game state lives in top-level `let`/`const` bindings (`grid`, `state`, `level`,
`moves`, `score`, `beams`, `cursor`) and the tests drive the game through
exactly those names plus `startGame()`, `loadLevel()`, `rotate()`,
`traceBeams()` and `isSolved()`. Rendering is a pure function of that state, so
a test can set up a board, trace, and assert without ever waiting on a frame.

## Assumptions

These were ambiguous in the brief; the simpler reading was taken in each case
and recorded here.

1. **Branch name.** The brief asks for a branch named after the game
   (`prism-path`), but the session's standing instruction pins all work to the
   assigned branch `claude/compassionate-ramanujan-lkvtth`. The assigned branch
   wins; the game name shows up in the folder, commit message and PR title
   instead.
2. **Only mirrors rotate.** Prisms, filters and emitters are fixed. Making
   everything rotatable would blow up the search space without making the
   puzzles more interesting.
3. **Mirrors have two states, not four.** A 90° rotation of a diagonal mirror
   is the other diagonal, so "rotate" and "flip" are the same operation here.
4. **No fail state.** Par only affects the score. A puzzle with a move limit
   would need an undo system to be fair, which is out of scope.
5. **Exact colour matching.** A white beam does not light a red target. The
   alternative (a target lights if its colour is a subset of the beam) makes
   filters nearly pointless.
6. **Beams stop at targets.** A target absorbs whatever reaches it, matching or
   not, so a target can never be a pass-through on the way to another one.
7. **Fixed 10x10 board at 48px cells.** 480x480 matches the canvas size the
   other games in this repo use and needs no responsive layout work.
