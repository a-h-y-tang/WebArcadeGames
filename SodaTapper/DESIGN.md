# Soda Tapper — Design

## Game concept

Soda Tapper is a single-screen arcade service game. You are the soda jerk behind
a four-counter fountain bar. Thirsty customers push in through the doors at the
**left** end of each counter and walk **right**, toward the tap station you are
standing at. Slide a full mug of soda down the counter to meet a customer and
they stop, drink, and wander back out the way they came — but the empty mug they
leave behind comes sliding straight back at you, and it has to be caught.

Three things end badly:

- a customer reaches the tap station and hauls you over the counter,
- a full mug runs the whole length of a counter and shatters on the floor,
- an empty mug comes back down a counter you are not standing at.

Each costs a life. Three lives, five waves, one score.

The tension is the split of attention: you can only be on one counter at a time,
and every mug you pour is a second errand coming back the other way.

## Playfield and geometry

| Constant | Value | Meaning |
|---|---|---|
| `W` × `H` | 760 × 600 | canvas size in CSS pixels |
| `LANES` | 4 | counters, indexed 0 (top) to 3 (bottom) |
| `LANE_TOP` / `LANE_GAP` | 124 / 120 | `laneY(i) = LANE_TOP + i * LANE_GAP` |
| `BAR_LEFT` | 70 | door end: customers enter here, full mugs shatter here |
| `TAP_X` | 650 | tap line: full mugs start here, empty mugs are caught here |
| `GRAB_X` | 620 | a customer reaching this grabs you |
| `CLOSE_X` | 480 | serving past this point pays the close-call bonus |
| `SERVER_X` | 698 | where you are drawn, behind the taps |

The whole bar lives in canvas coordinates, so a lane is just an index and an
`x` — there is no 2D collision anywhere in the game, only comparisons along a
single axis per lane. That is what keeps the simulation small enough to drive
from a test one step at a time.

## Mechanics

### Fixed timestep

Everything moves inside `physicsStep(dt)`, called at a fixed `DT = 1/120 s` from
the animation loop, which only accumulates time while `state === 'running'`. The
loop can be switched off entirely with `autoRun = false`, which is how the
Playwright suite takes manual control: freeze the loop, place a customer and a
mug at known positions, step the simulation, assert. `physicsStep` returns
immediately unless the game is running, so a test can keep stepping after a wave
ends without the bonus being paid twice.

### Speeds and timings

| Constant | Value | Meaning |
|---|---|---|
| `MUG_SPEED` | 260 px/s | a full mug sliding left |
| `EMPTY_SPEED` | 190 px/s | an empty mug sliding back right |
| `RETREAT_SPEED` | 110 px/s | a served customer walking back out |
| `DRINK_TIME` | 1.0 s | how long a customer stands and drinks |
| `POUR_COOLDOWN` | 0.3 s | minimum gap between two pours |
| `CATCH_RANGE` | 16 px | how close a mug must get to a customer to be taken |
| `customerSpeed(wave)` | `26 + 7 × wave` px/s | advance speed, per wave |

### Customer lifecycle

A customer is `{ lane, x, phase, drinkTimer }` and moves through three phases:

1. `advancing` — walking right at `customerSpeed(wave)`. Reaching `GRAB_X`
   removes the customer and costs a life.
2. `drinking` — stopped, holding a mug, `drinkTimer` counting down from
   `DRINK_TIME`. A drinking customer cannot be served again, so a second mug
   slides straight past to whoever is behind them.
3. `leaving` — walking left at `RETREAT_SPEED`. Crossing `BAR_LEFT` removes the
   customer for good. The empty mug is released at the *start* of this phase,
   from wherever the customer was standing.

### Mugs

Both kinds of mug live in one `mugs` array as `{ lane, x, kind }` with `kind`
either `'full'` or `'empty'`.

- A **full** mug starts at `TAP_X` in the lane you are standing in and slides
  left. On each step it is tested against the *frontmost* (largest `x`)
  `advancing` customer in its lane: if `mug.x <= customer.x + CATCH_RANGE` the
  customer takes it. Reaching `BAR_LEFT` un-taken shatters it and costs a life.
- An **empty** mug slides right. When it reaches `TAP_X` it is caught if you are
  standing in its lane (points) and smashes if you are not (a life).

The catch test is a single comparison made on the step the mug crosses the tap
line, so "was I there in time?" has one unambiguous answer rather than depending
on frame rate.

### Waves

`buildWave(n)` returns the complete spawn schedule for wave `n` as an array of
`{ lane, t }` entries sorted by time, where `t` is simulated seconds from the
start of the wave. It draws from a small seeded LCG whose seed is derived from
`n` alone, so every run of wave 3 is the same wave 3 — a wave is reproducible
without the test having to stub anything out.

| Quantity | Formula | Wave 1 | Wave 5 |
|---|---|---|---|
| Customers | `6 + 2 × n` | 8 | 16 |
| Mean gap between arrivals | `max(0.9, 2.6 − 0.3 × n)` s | 2.3 | 1.1 |
| Customer speed | `26 + 7 × n` px/s | 33 | 61 |

`waveTimer` accumulates simulated time and entries are shifted off
`spawnQueue` as they come due. A wave is complete when the queue is empty, no
customers are left on the bar, and no mugs are in flight; that pays
`waveBonus() = 100 × wave + 50 × lives` and moves to `wavecomplete`, or to
`won` after wave `WAVE_COUNT` (5).

### Scoring

| Event | Points |
|---|---|
| Serving a customer | 50 |
| Serving one past `CLOSE_X` (close call) | +50 |
| Catching an empty mug | 25 |
| Finishing a wave | 100 × wave + 50 × lives remaining |

`served` and `caught` are tracked separately from the score for the HUD. The
best score is written to `localStorage` under `sodatapper-best` whenever a run
ends and is read back on load.

### States

`state` is one of `idle`, `running`, `paused`, `wavecomplete`, `gameover`,
`won`. `advance()` is the single "Space / click / Start button" entry point: it
starts a run from `idle`, starts the next wave from `wavecomplete`, and restarts
from `gameover` or `won`. While `running`, Space pours instead.

## Controls

| Input | Action |
|---|---|
| `↑` `↓` / `W` `S` | move between counters |
| Mouse over the bar | jump to the counter under the pointer |
| `Space` / click | pour a mug (or start / continue on an overlay) |
| `P` | pause and unpause |

## Files

- `index.html` — page shell, HUD, canvas, overlay
- `style.css` — cabinet styling
- `game.js` — simulation and rendering
- `tests/soda-tapper.spec.js` — Playwright suite
- `README.md` — how to play

## Assumptions

The task description left a few things open. Each was resolved toward the
simpler reading and recorded here.

1. **Branch name.** The task asked for a branch named after the game
   (`soda-tapper`), but this session's standing instructions designate
   `claude/compassionate-ramanujan-636pna` and forbid pushing anywhere else.
   The designated branch wins; the game name lives in the folder and the commit
   message instead.
2. **Novelty.** The repository already holds many shooters, platformers and
   grid puzzles, so "novel" was read as a mechanic family not yet present rather
   than merely a new title: lane-based *service* play (pour, serve, catch the
   return) is the gap this fills.
3. **Theme.** The arcade ancestor of this mechanic serves beer; this one serves
   soda, so nothing in the game depends on alcohol.
4. **Customers are not pushed back.** In the original, a thrown mug knocks a
   customer backward along the bar and repeated mugs are needed. Here a single
   mug serves a customer outright — one clear rule rather than a damage counter,
   and it keeps the simulation to one comparison per mug per step.
5. **A life is lost, not the wave.** Losing a life does not reset the bar or
   clear the customers in play; the run simply continues with one fewer life.
   Resetting mid-wave would need a second "respawn" state for very little gain.
6. **Mugs pass drinking customers.** Only `advancing` customers take a mug, so a
   mug poured into a lane where someone is already drinking travels on to the
   next customer behind them. This makes over-pouring a real risk instead of a
   free action.
7. **Five waves is a full run.** The repository's other games end rather than
   scaling forever, so wave 5 finishes a run with a `won` state.
8. **One pour per 0.3 s, no mug limit.** Rather than capping mugs per lane, the
   cooldown alone limits pouring; the returning empties are the natural penalty
   for spamming.
