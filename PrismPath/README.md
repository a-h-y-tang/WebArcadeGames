# Prism Path

A laser fires into a grid of mirrors, prisms and colour filters. Turn the
mirrors until every target on the board glows in the colour it is asking for.

Nothing moves on its own, nothing is on a timer, and the board always shows you
the truth: every beam is re-traced the moment you turn a mirror.

## How to play

1. Press **Space**, or click **Start Game**.
2. Click a mirror — or move the cursor onto it and press **Space** — to turn it
   between `/` and `\`.
3. Light every target at once to clear the level. Six levels make a full run.

## The pieces

| Piece | Looks like | What it does |
|---|---|---|
| Emitter | a glowing nozzle in a steel block | Fires a **white** beam. Opaque to other beams |
| Mirror | a bright diagonal bar | Reflects the beam 90°. **The only piece you can change** |
| Prism | a dashed amber diagonal | Reflects *and* passes the beam through — one beam in, two out |
| Filter | a coloured diamond | Tints the beam. A beam with no colour left dies here |
| Target | a coloured ring | Lights up when a beam of **exactly** its colour arrives |
| Wall | a slate block | Stops the beam dead |

### Colours

Beams carry red, green and blue channels. A filter keeps only the channels it
shares with the beam:

- white through **red** → red
- white through **yellow** then **cyan** → green (yellow is R+G, cyan is G+B)
- red through **blue** → nothing, and the beam stops

Targets match exactly, so a white beam will *not* light a red target. If a
target wants red, the beam has to pass a red filter on the way.

## Controls

| Input | Action |
|---|---|
| Mouse | Moves the cursor; click a mirror to turn it |
| Arrow keys / **WASD** | Move the cursor |
| **Space** / **Enter** | Turn the mirror under the cursor |
| **Space** / **Enter** / click | Start the game, or move on from a cleared level |
| **R** | Restart the current level |
| **N** | Next level once the board is solved |

## Scoring

Every level has a **par** — the number of turns in the intended solution.
Clearing a level pays **100**, plus **25 for every turn you came in under par**.
There is no way to lose: a messy solve still moves you on, it just pays less.
The best total for a full six-level run is remembered between sessions.

## Levels

| # | Name | Par | Introduces |
|---|---|---|---|
| 1 | First Light | 1 | A single mirror |
| 2 | Red Shift | 2 | Colour filters |
| 3 | Split Decision | 2 | Prisms, and two targets at once |
| 4 | Two Tone | 3 | One prism feeding two different colours |
| 5 | Crossfire | 4 | A second emitter |
| 6 | Grand Finale | 5 | Everything, three colours deep |

## Running the tests

From the repository root:

```powershell
npx playwright test PrismPath/tests/
```

The suite covers reflection in all four directions, filter mask arithmetic,
prism splitting, loop termination, the cursor and click handling, scoring and
progression. It also brute-forces all `2^n` mirror combinations of every
shipped level to prove each one is solvable, is *not* already solved on load,
and is solvable within its stated par.

## How it works

See [DESIGN.md](DESIGN.md) for the beam tracer, the colour model and the design
decisions behind them.
