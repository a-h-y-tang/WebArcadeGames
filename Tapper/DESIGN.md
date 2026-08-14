# Tapper — Design

## Concept

Four parallel bars run left-to-right across the screen. The bartender works the
taps at the right-hand end of all four and can only be on one bar at a time.
Thirsty customers push in through the doorways on the left and walk steadily
toward the taps. Slide a full mug down the right bar and the customer who
catches it drinks, gets pushed back down the counter and heads home — leaving an
empty mug rolling back toward the taps that the bartender has to be in place to
catch.

The tension is entirely one of routing attention: every pour commits a mug to a
lane, every empty mug on its way back is a deadline, and the customer nearest
the taps is a countdown. Clear the round's whole crowd to move to the next,
where more customers arrive, faster.

## Mechanics

### Bars and geometry

- `LANES = 4` bars at `LANE_Y = [76, 176, 276, 376]` on a 640×460 canvas.
- `BAR_LEFT = 56` is the doorway end: customers enter here and stray full mugs
  shatter here.
- `TAP_X = 588` is where a poured mug appears; `CATCH_X = 578` is where a
  returning empty mug is either caught or lost; `GRAB_X = 572` is the point at
  which an unserved customer reaches over the counter.

### Losing a life

There are exactly three ways to break glass, and all three cost one life:

1. A full mug reaches `BAR_LEFT` without meeting a customer.
2. An empty mug reaches `CATCH_X` on a bar the bartender is not standing at.
3. A customer reaches `GRAB_X`.

A mistake clears every customer and mug from the room (`loseLife()`), holds the
game in `dying` for `DEATH_PAUSE = 1.5s`, and then resumes the round at the
point it had reached — the served count and the level are untouched. At zero
lives the run ends and the best score is written to `localStorage`
(`tapper-best`).

### Serving

A full mug travels left at `MUG_SPEED = 300 px/s`. On each step it looks for the
customer on its own bar nearest the taps whose centre is within
`CATCH_DIST = 26px`, and only customers still `advancing` qualify. That customer
is served: `+100`, state becomes `drinking` for `DRINK_TIME = 1s` while sliding
back at `PUSH_SPEED = 90 px/s`, then it emits an empty mug at its own position
and walks off the left edge.

An empty mug travels right at `EMPTY_SPEED = 220 px/s`. Reaching `CATCH_X` on
the bartender's bar scores `+50`; on any other bar it smashes.

### Rounds

Round `n` sends `min(6 + 2(n-1), 20)` customers, one every
`max(2.4 - 0.15(n-1), 0.9)` seconds, walking at
`min(28 + 4(n-1), 130) px/s` — capped well below `MUG_SPEED` so a poured drink
can always overtake the crowd. A round clears once the whole crowd has entered
and the room is empty of both customers and mugs, worth a `+500` bonus, after
which `CLEAR_PAUSE = 1.8s` of banner leads into the next round.

Lanes are chosen from a fixed rotation (`LANE_PATTERN`) rather than
`Math.random`, so a run replays identically and the pressure stays spread across
all four bars.

## Controls

| Input | Action |
|---|---|
| <kbd>↑</kbd> / <kbd>↓</kbd>, <kbd>W</kbd> / <kbd>S</kbd> | Move the bartender between bars |
| <kbd>Space</kbd> | Pour a mug down the current bar (also starts a run) |
| Click the canvas | Pour a mug |
| <kbd>Enter</kbd> | Start / restart |
| <kbd>P</kbd> | Pause / resume |

Pouring is rate limited by `POUR_COOLDOWN = 0.35s`, so holding Space cannot
carpet a bar with mugs.

## Code shape

`game.js` is a single classic (non-module) script — the same shape as
BurgerTime, Snake and Tetris in this repo — so all state and helpers are plain
globals the Playwright specs can reach through `page.evaluate`.

- `step(dt)` advances everything; it is a no-op in `idle`, `paused` and `over`,
  ticks only timers in `dying` and `levelclear`, and is called from the
  `requestAnimationFrame` loop with a real delta. Because all motion is
  expressed per second, the tests drive `step(1/60)` in a loop and get identical
  results without depending on wall-clock timing.
- `draw()` is pure rendering and never mutates simulation state, so it can be
  called in any state from the specs.
- Test seams: `spawnEnabled` (switch off automatic arrivals),
  `spawnCustomer(lane)`, `spawnEmpty(lane, x)`, `pour()`, `moveLane(delta)` and
  `serveEverythingForTest()`.

State machine: `idle → running ⇄ paused`, `running → dying → running | over`,
`running → levelclear → running`.

## Assumptions

These were ambiguous in the brief; the simpler reading was taken each time and
recorded here.

- **Branch name.** The brief asks for a branch named after the game
  (`tapper`), but this session is pinned to the assigned development branch
  `claude/loving-euler-wp2ucd`, which takes precedence. Work was committed
  there.
- **One drink per customer.** In the 1983 arcade original a customer can be
  pushed back repeatedly and needs several drinks. Here one mug satisfies a
  customer outright — it keeps the round length readable and the scoring
  obvious.
- **Only advancing customers catch mugs.** A mug that reaches a customer who is
  already drinking or leaving passes straight through and carries on to the end
  of the bar. This avoids "free" saves from a customer who is already done.
- **No tip trays or bonus rounds.** The original's coin/bonus screens are out of
  scope; the round bonus stands in for them.
- **Instant lane changes.** The bartender snaps between bars on key press rather
  than sliding, which keeps the input model discrete and easy to reason about.
- **Deterministic lane order.** Arrivals follow a fixed rotation instead of
  random lanes, so runs are reproducible for testing.
- **Empty mugs are caught automatically** when the bartender is on the right
  bar — there is no separate catch button.
