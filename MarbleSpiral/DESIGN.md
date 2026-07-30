# Marble Spiral — Design

## Concept

Marble Spiral is a path-based marble shooter in the lineage of *Puzz Loop* and
*Zuma*. A train of coloured marbles crawls along a spiral track that winds
inwards towards a pit in the middle of the board. The player sits in the eye of
the spiral, aiming a shooter in any direction and firing marbles into the train.
Three or more marbles of the same colour touching each other pop; clear every
marble in the level before the leading marble drops into the pit.

It is deliberately *not* a grid game: unlike the repo's existing Bubble Shooter
and Match-3, marbles live on a one-dimensional track, and the interesting
mechanics — insertion, shoving the tail back, gaps closing into combos — all
come from that.

## Mechanics

### The track

The spiral is generated once at load time from a parametric curve (radius
shrinking from 310 px to 95 px over 2.3 turns, squashed vertically by 0.72 to
fit the 600×480 canvas) and then **re-sampled at one-pixel arc-length steps**.
That single trick keeps the rest of the code simple: `pathPoint(d)` is an array
lookup, and every marble's position is just one number — the distance `d` it has
travelled along the track. Distance 0 is the entrance (off the right edge of the
canvas, so marbles slide into view); `PATH_LEN` is the pit.

### The train

`balls` is ordered head-first: index 0 is the leading marble, closest to the pit.
Each frame:

1. The leading marble advances at `levelSpeed(level)` px/s.
2. Every other marble is held at exactly `SPACING` (26 px, one marble diameter)
   behind the marble ahead of it. If it is further back than that — a gap left by
   a clear — it closes the gap at `CATCH_SPEED` (300 px/s).

So the train is a pure follow-the-leader chain; no physics, no per-marble
velocity. Marbles waiting to enter live in `queue` and are fed onto the track at
distance 0 as soon as there is room for them.

### Shooting and insertion

The shooter is fixed at the centre of the spiral and always holds a *current*
and a *next* marble, both drawn only from colours still in play — once the last
red is gone the shooter will never hand you a red again.

A fired marble flies in a straight line (sub-stepped so it cannot tunnel through
the train) and joins the train when it comes within one marble diameter of a
marble on the track. Which side it joins on is decided by projecting the shot
onto the track's forward direction at the marble it touched: in front, or behind.

**Insertion never pushes the head forwards** — the new marble takes the track
position it landed at and everything behind it is shoved back. Shooting can
therefore never lose you the game.

### Popping, gaps and combos

After an insertion the run of same-coloured marbles containing the new one is
measured; three or more pop and score `count × 10 × multiplier`.

A pop leaves a hole in the train. The marble now trailing that hole is flagged
`detached`, and when it catches up with the front section:

- if the colours across the junction match, that run pops too and the combo
  multiplier goes up (2×, 3×, …) — this is where the big scores come from;
- if not, the train simply becomes whole again.

The `detached` flag matters: without it, any three-in-a-row the level happened to
start with would pop by itself, because the leading marble's advance opens a
sub-pixel "gap" behind it every single frame.

### Levels, winning and losing

| Quantity           | Formula                            | Level 1 |
|--------------------|------------------------------------|---------|
| Marbles in a level | `30 + (level - 1) × 6`             | 30      |
| Colours in play    | `min(6, 3 + floor((level - 1) / 2))` | 3     |
| Train speed (px/s) | `24 + (level - 1) × 5`             | 24      |

Clear the track and the queue (and nothing still in flight) and the level is
complete: a `100 × level` bonus is awarded and the overlay offers the next level.
The score carries across levels. If the leading marble reaches `PATH_LEN` the
game is over and the best score is written to `localStorage` under
`marble-spiral-best`.

## Controls

| Input | Action |
|---|---|
| Mouse move | Aim the shooter |
| Click | Fire |
| Space | Fire (or start / continue when the overlay is up) |
| S or right-click | Swap the current and next marble |
| P | Pause / resume |

## Code map

| File | Contents |
|---|---|
| `index.html` | HUD (score, level, marbles left, best), canvas, overlay, help line |
| `style.css` | Dark arcade panel styling shared in spirit with the other games |
| `game.js` | Track generation, simulation (`step`), rendering, input |
| `tests/marblespiral.spec.js` | 66 Playwright tests driving the globals directly |

`game.js` keeps its state in plain globals (`state`, `score`, `level`, `balls`,
`queue`, `shots`, `shooter`) and exposes `step(dt)` separately from the
`requestAnimationFrame` loop, matching the convention used by the other games in
this repo. The tests advance the simulation deterministically by calling
`step(dt)` themselves rather than waiting on real frames. `setChain(colors,
headDist)` and `spawnShot(x, y, color, vx, vy)` are deliberate test seams for
laying out a known train and dropping a marble at a known spot.

## Assumptions

These were decisions taken while building the game with nobody to ask; the
simpler reading was chosen each time.

- **Branch name.** The task asked for a branch named after the game
  (`marble-spiral`), but this session is required to develop on its designated
  branch `claude/loving-euler-eqrtcg`, so the work lives there instead.
- **No power-ups.** The genre traditionally has slow-down, reverse, accuracy and
  bomb marbles. They are omitted; the core loop is insertion, matching and
  combos.
- **No reverse/backwards momentum.** After a pop, real Zuma briefly rolls the
  front section *backwards*. Here the front section simply keeps crawling
  forwards and only the tail moves, which is easier to reason about and to test.
- **One track shape for every level.** Difficulty comes from speed, marble count
  and colour count rather than from new track layouts.
- **Unlimited marbles in flight.** There is no cap on simultaneous shots and no
  reload delay; rapid clicking is allowed.
- **Fixed shooter position.** The shooter never moves — only its angle changes.
- **The pit is instant death.** A single marble reaching the pit ends the run;
  there are no lives.
- **Colours are hex strings** (`'#ff4d5a'`, …) used both as identity and as fill
  colour, so tests can assert on them directly.
- **`localStorage` may be unavailable** (e.g. some `file://` sandboxes); writes
  are wrapped in `try`/`catch` and the game carries on without a stored best.
