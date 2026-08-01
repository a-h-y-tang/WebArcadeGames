# Soda Tapper — Design

## Concept

Soda Tapper is a lane-based serving game in the spirit of the classic
bartender arcade cabinets. Four bars run across the screen. Thirsty customers
walk on at the far (left) end of a bar and shuffle toward the tap. The server
stands at the tap end and slides full mugs of soda down whichever bar they are
currently standing at.

A mug that catches up with a customer knocks them back down the bar while they
drink. Knock a customer clean off the far end and they leave happy — and send
their empty mug sliding back toward the tap, which the server has to be in the
right lane to catch.

The tension comes from splitting attention across four bars: every mug you pour
is a mug you must later catch, so pouring more than you can keep up with is how
runs end.

## Mechanics

### Layout

- Canvas is a fixed 600 × 400.
- `LANE_COUNT = 4` bars; bar *i*'s surface sits at `laneY(i) = 74 + i * 86`.
- `BAR_LEFT = 60` is the far end of a bar; `TAP_X = 520` is the tap/server
  station. Empties are caught at `CATCH_X = 508`, just short of the tap.

### The three moving things

| Thing | Direction | Speed |
|---|---|---|
| Full mug | right → left | `MUG_SPEED = 260` px/s |
| Empty mug | left → right | `EMPTY_SPEED = 210` px/s |
| Customer | left → right | `22 + 4 × level` px/s |

### Pouring

`serve()` puts a full mug on the server's current bar. It is limited two ways:

- **A cooldown** (`SERVE_COOLDOWN = 0.3 s`) so a single bar cannot be spammed.
- **A tray** of `MUG_TRAY = 4` mugs. Pouring spends one; catching a returned
  empty puts one back (capped at 4). A lost life or a new level refills the
  tray. Running the tray dry is a soft failure state — you have to catch up
  before you can pour again.

### Serving a customer

When a full mug reaches a customer in the same lane, the mug is consumed and
the customer:

1. is knocked back `PUSH_KNOCK = 60` px instantly,
2. drinks for `PUSH_TIME = 0.7 s`, sliding back at `PUSH_SPEED = 120` px/s,
3. resumes walking toward the tap if they are still on the bar.

That is ~144 px of pushback per mug, so a customer who has walked a long way
needs several mugs. Landing a mug scores `HIT_SCORE = 25`; pushing a customer
off the end of the bar scores `SERVE_SCORE = 100`, counts toward the level, and
sends an empty back. Catching that empty scores `CATCH_SCORE = 50`.

### Losing a life

Three ways, all worth `-1` life:

- a full mug reaches the far end of a bar without meeting a customer (it smashes),
- an empty reaches the tap while the server is on a different bar,
- a customer reaches the tap.

Losing a life clears every bar, refills the tray and restarts the spawn timer,
so play resumes from a clean board. At zero lives the game ends and the best
score is written to `localStorage` under `soda-tapper-best`.

### Levels

Level *n* sends `4 + 2n` customers. They spawn on a random bar that has room at
its far end, every `max(1.0, 3.2 − 0.25n)` seconds, after an initial
`SPAWN_FIRST = 2.5 s` grace period. A level is cleared once every customer for
that level has been served *and* the bars are empty of customers, mugs and
empties — so you cannot advance while a mug is still in flight. Clearing awards
`200 × level` bonus points; customers also walk faster each level.

## Controls

| Input | Action |
|---|---|
| <kbd>↑</kbd> / <kbd>W</kbd> | Move up one bar |
| <kbd>↓</kbd> / <kbd>S</kbd> | Move down one bar |
| <kbd>Space</kbd> | Pour a soda (or start / resume) |
| Mouse move | Move the server to the bar under the pointer |
| Mouse click | Pour a soda (or start / resume) |
| <kbd>P</kbd> | Pause / resume |
| <kbd>Enter</kbd> | Start / resume |

## Code structure

- `index.html` — canvas, HUD (`#score`, `#level`, `#lives`, `#best`) and the
  start/game-over overlay.
- `style.css` — the surrounding cabinet chrome; the play field itself is drawn
  entirely on the canvas.
- `game.js` — a single classic (non-module) script. State lives in top-level
  globals (`state`, `score`, `level`, `lives`, `mugsLeft`, `customers`, `mugs`,
  `empties`) so the Playwright tests can read and drive it directly, matching
  Kaboom, Dino Run and Tetris in this repo.

All motion is expressed per second and applied by `step(dt)`, which is the only
function that mutates the world. `requestAnimationFrame` merely computes a `dt`
and calls `step` then `draw`, so tests advance the simulation deterministically
with fixed `step(0.016)` calls instead of waiting on wall-clock time. `step()`
is a no-op unless `state === 'running'`, which is what makes pausing work.

Rendering is separated into `draw*` helpers and never mutates state.

## Testing

`tests/soda-tapper.spec.js` drives the page over a `file://` URL — no server —
and covers the idle/start/pause/game-over state machine, lane movement, pour
throttling and the tray, customer walking and level scaling, mug/customer
collision and pushback, empties being caught and missed, all three ways to lose
a life, level completion, and score/best-score persistence.

Tests that simulate several seconds set `spawnTimer = 1e9` first to suppress
automatic customer spawns, so the assertion is about the one scripted customer
rather than whatever the spawner happened to do.

## Assumptions

These were resolved without asking, taking the simpler reading each time:

- **Branch name.** The task asked for a branch named after the game
  (`soda-tapper`), but this session is pinned to the designated branch
  `claude/loving-euler-m3ocqs` and is not permitted to push elsewhere. The work
  is on the designated branch; the game name is carried by the folder instead.
- **Name.** Called "Soda Tapper" rather than reusing the trademarked arcade
  title, and soda rather than beer to keep it in line with the rest of the
  repo.
- **One server sprite, four bars.** The server teleports between bars instead
  of running along a back alley. Lane switching is instant, which is how the
  keyboard controls read anyway, and it keeps the state to a single lane index.
- **Customers do not throw mugs back.** In the original, drinking customers
  slide their empty back immediately. Here an empty is only produced when a
  customer leaves, so each served customer generates exactly one thing to
  catch. That keeps the catch load proportional to progress.
- **No tip/bonus round.** The classic bonus stages are out of scope; levels
  differ only in customer count and speed.
- **Losing a life clears the board** rather than pausing and resuming mid-state.
  This avoids the situation where you lose a life and immediately lose another
  to a customer who was already at the tap.
- **Difficulty scaling is linear** in the level number — simple, and easy to
  assert in tests.
