# Soda Tapper — Design

## Concept

You are the only server behind a four-counter soda bar. Thirsty customers walk
in from the far end of each counter and march steadily toward you. Slide a full
mug down a counter to meet a customer: they catch it, stagger back while they
drink, and then shove the empty mug straight back at you. Catch the empties,
keep every counter clear, and survive as the crowds get bigger and faster.

Three ways to lose a life:

1. A customer reaches your end of a counter and grabs you.
2. A full mug slides all the way to the far end and smashes on the floor.
3. An empty mug comes back to your end while you are standing at another
   counter, and smashes.

Lose all three lives and the shift is over.

## Mechanics

### Geometry

The canvas is 640x480. Four counters run horizontally, their surfaces at
`y = 96, 192, 288, 384`. Each counter spans `x = 70` (the far end, where
customers enter and stray mugs fall) to `x = 556` (the near end, where the taps
are). The server sprite stands at `x = 590` on whichever counter it has
selected.

### Simulation

Everything advances through a single `physicsStep(dt)` on a fixed `1/120 s`
timestep, driven by an accumulator in the animation loop. Each step, in order:

1. **Spawning.** `levelTime` accumulates; every queued customer whose scheduled
   time has arrived is pushed onto the counter at `x = LANE_LEFT`.
2. **Cooldowns.** The pour cooldown ticks down (`0.28 s`), which is what stops
   a held key from flooding a counter with mugs.
3. **Full mugs** travel left at `250 px/s`. A mug that overlaps a
   non-drinking customer on the same counter serves the *rightmost* such
   customer (the one nearest the taps gets the drink). A mug that reaches
   `LANE_LEFT` smashes and costs a life.
4. **Serving** pushes the customer back `130 px`, starts a `0.9 s` drink, and
   scores 50.
5. **Customers.** A drinking customer stands still until the timer expires,
   then launches an empty mug rightward and resumes walking — unless the
   pushback has carried them past the entrance, in which case they leave happy
   for 150 points. A walking customer advances at `20 + 6*(level-1) px/s`; one
   that reaches `LANE_RIGHT` grabs the server and costs a life.
6. **Empty mugs** travel right at `190 px/s`. One that reaches `LANE_RIGHT` is
   caught for 25 points if the server is on that counter, and otherwise smashes
   for a life.
7. **Level clear** when the spawn queue, the customers, the mugs and the
   empties are all gone: 300 point bonus, then the next level on a keypress.

Because a customer is pushed back a fixed distance, how many mugs a customer
costs you depends on how far they have walked: a new arrival is served with one
mug, while one that has reached the taps needs four.

### Levels

`buildLevel(n)` returns a deterministic spawn queue — `6 + 2n` customers, lanes
and gaps drawn from a small LCG seeded with the level number, gaps shrinking
from about 3.2 s toward a 1.4 s floor. The same level always produces the same
wave, so a run is reproducible and the test suite can rely on it.

### Scoring

| Event | Points |
|---|---|
| Mug caught by a customer | 50 |
| Empty mug caught at the taps | 25 |
| Customer leaves happy | 150 |
| Level cleared | 300 |

The best score is kept in `localStorage` under `sodatapper-best`.

## Controls

| Input | Action |
|---|---|
| <kbd>&uarr;</kbd> / <kbd>&darr;</kbd>, <kbd>W</kbd> / <kbd>S</kbd> | Move between counters |
| <kbd>Space</kbd> | Pour and slide a mug (also starts the game / advances a level) |
| Click a counter | Move to that counter and pour |
| <kbd>P</kbd> | Pause / resume |

## Code layout

- `index.html` — HUD, canvas, overlay, help text.
- `style.css` — dark bar-room palette, no layout framework.
- `game.js` — constants, state, `physicsStep`, input handlers, `render`.
- `tests/soda-tapper.spec.js` — the Playwright suite the game was built from.

State the tests drive lives at the top level of `game.js` on purpose:
`state`, `score`, `level`, `lives`, `served`, `customers`, `mugs`, `empties`,
`server`, `spawnQueue`, `levelTime` and `autoRun`. A test sets `autoRun = false`
to freeze the animation loop, arranges the arrays it cares about, and calls
`physicsStep(1/120)` as many times as it needs — no timing races.

## Assumptions

These were resolved without asking, choosing the simpler reading each time:

- **Branch name.** The task asked for a branch named after the game
  (`soda-tapper`), but this session is under standing instructions to develop
  and push on `claude/compassionate-ramanujan-2160pv`. The standing instruction
  wins; the game name lives in the folder and commit message instead.
- **Losing a life does not reset the wave.** The arcade original clears the
  screen and restarts the wave. Here only the offending customer or mug is
  removed and play continues, which is simpler and keeps the simulation
  purely incremental.
- **Lane changes are per keypress, not held-key repeat.** Holding Down moves
  one counter, not four. Four lanes are few enough that repeat adds nothing but
  overshoot.
- **One customer catches one mug.** A mug is consumed by the first customer it
  overlaps rather than passing through to a line of them.
- **Drinking customers are untouchable.** A mug cannot be served to a customer
  mid-drink; it slides past them. This avoids stacking pushbacks and keeps the
  "wait for the empty" rhythm of the original.
- **No separate bonus round.** The original cuts to a shell game between waves;
  here a level simply ends with a flat 300 point bonus.
- **Sound is omitted.** Every other game in this repo is silent, and audio is
  not testable headlessly.
