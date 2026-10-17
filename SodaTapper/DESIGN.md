# Soda Tapper — Design

## Concept

Soda Tapper is a single-screen reflex game in the spirit of the 1983 arcade
cabinet *Tapper*. You work the taps at the right-hand end of a four-counter
soda fountain. Thirsty customers push in through the doors at the far (left)
end of every counter and walk steadily towards you. The only thing that stops
them is a cold drink slid the length of the bar.

A served customer skids backwards while they drink, then hands the empty glass
back — and an empty glass is a problem of its own. It comes sliding down the
counter towards you, and if you are not standing at that tap when it arrives it
sails off the end and smashes. The game is therefore not "spam the serve key":
every drink you pour creates a second obligation a few seconds later, in a lane
you may have had to leave in the meantime.

Push a customer all the way back out of the door and they leave satisfied.
Clear the whole wave and the next shift starts, faster and busier.

## Board

The canvas is 720 × 480. Four counters (lanes) run horizontally across it.

| Constant | Value | Meaning |
|---|---|---|
| `LANES` | 4 | number of counters |
| `LANE_H` | 96 | counter pitch in pixels |
| `LANE_TOP` | 48 | y of the first counter's band |
| `COUNTER_LEFT` | 60 | far end: customers enter here, glasses smash here |
| `COUNTER_RIGHT` | 640 | tap end: you stand here, empties are caught here |

`laneY(i)` returns the centre line of counter `i`, i.e. `LANE_TOP + LANE_H * i + LANE_H / 2`.

All motion is expressed in pixels per second and advanced through `step(dt)`, so
the Playwright suite can simulate frames deterministically without depending on
`requestAnimationFrame` wall-clock timing — the same approach the other games in
this repo use.

## Entities

### Customer

`{ lane, x, state, slideLeft }` where `state` is `advancing` or `sliding`.

* **advancing** — `x` increases at `customerSpeed` (lane-independent, set by the
  level). Reaching `COUNTER_RIGHT` means the customer got to the taps: a life is
  lost.
* **sliding** — `x` decreases at `SLIDE_SPEED` until `slideLeft` pixels of
  push-back have been spent, then the customer resumes advancing. A customer
  pushed past `COUNTER_LEFT` walks out of the door: `EXIT_POINTS` and gone.

### Full mug

`{ lane, x }`, created at `COUNTER_RIGHT` by `serve()` and sliding left at
`MUG_SPEED`. A mug that reaches `COUNTER_LEFT` with nobody to catch it smashes
on the floor and costs a life.

### Empty mug

`{ lane, x }`, created where a customer catches a drink and sliding right at
`EMPTY_SPEED`. On reaching `COUNTER_RIGHT` it is caught — `EMPTY_POINTS` — if
the bartender is standing in that lane, and smashes for a life if not.

### Catching

A mug only ever moves left and customers only ever start to its left, so the
collision test is monotone and cannot tunnel: a mug catches the **right-most**
customer in its lane whose `x >= mug.x - CATCH_DIST`. The customer is pushed
back `PUSH_DIST`, `SERVE_POINTS` are scored, and an empty is spawned at the
customer's position.

## Rules

| Event | Effect |
|---|---|
| mug caught by a customer | `+50`, customer slides back 150 px, empty spawned |
| customer pushed out of the door | `+100`, customer removed, `served` + 1 |
| empty caught at the taps | `+10` |
| wave cleared | `+200`, next level |
| customer reaches the taps | life lost |
| full mug falls off the far end | life lost |
| empty mug reaches the taps with nobody there | life lost |

Losing a life clears every customer, mug and empty from the bar; the wave then
resumes spawning whatever it had left. At zero lives the game is over and the
best score is written to `localStorage` under `sodatapper-best`.

## Waves

Level `n` spawns `WAVE_BASE + WAVE_STEP * (n - 1)` customers (6, 8, 10, …) at
`max(SPAWN_MIN, SPAWN_BASE - SPAWN_STEP * (n - 1))` second intervals, walking at
`CUSTOMER_SPEED_BASE + CUSTOMER_SPEED_STEP * (n - 1)` px/s. Lanes are picked by a
seeded LCG (`setSeed`) so the suite can rely on a reproducible sequence.

A wave is clear when every customer has spawned and the bar is empty of
customers, mugs and empties. The next wave opens with a `BANNER_TIME` pause
during which nothing spawns and a `LEVEL n` banner is drawn.

## Controls

| Input | Action |
|---|---|
| `↑` `↓` or `W` `S` | step between counters |
| `Space` / `Enter` | serve a drink down the current counter (or start the game) |
| `P` | pause |

Serving has a `SERVE_COOLDOWN` of 0.18 s so a held key cannot flood a lane.

## Rendering

A single canvas, drawn fresh each frame: four wood-grain counters, the doors at
the far end, the tap bank and bartender at the near end, customers as rounded
figures that lean back while drinking, full mugs as amber glasses with a foam
head and empties as hollow outlines. The HUD above the canvas (score, served,
level, lives, best) is plain DOM so it stays crisp and is trivially assertable
from the tests.

## Testing

`game.js` is a classic (non-module) script, so every piece of state and every
helper is reachable from Playwright as a plain global: `state`, `score`,
`lives`, `level`, `served`, `customers`, `mugs`, `empties`, `bartenderLane`,
`spawnTimer`, `spawned`, `waveSize`, `customerSpeed`, plus `step`, `serve`,
`startGame`, `togglePause`, `spawnCustomer` and `setSeed`. Setting
`autoStep = false` detaches the simulation from the animation loop and leaves
time entirely under the test's control; setting `spawnTimer` to a large value
stops the wave from spawning customers behind a spec's back.

## Assumptions

Decisions made without a human to ask, each resolved to the simpler reading:

1. **Branch name.** The task asked for a branch named after the game
   (`soda-tapper`), but this session's standing instructions pin all work to the
   designated branch `claude/compassionate-ramanujan-xogik6` and forbid pushing
   anywhere else. The designated branch wins; the game name lives in the folder
   and commit message instead.
2. **Catching empties is positional, not a keypress.** The original cabinet has
   the player collect empties with the serve button. Here an empty is caught
   automatically if — and only if — the bartender happens to be standing in that
   lane when it arrives. Same skill (be in the right place), one fewer input.
3. **One drink per push.** Customers have no hidden thirst counter. Every drink
   pushes back a fixed 150 px, so a customer near the door leaves after one and
   a customer near the taps needs several.
4. **Sliding customers can still catch.** A customer already drinking will take
   a second drink if one reaches them, and is pushed further. Stacking is a
   legal (if wasteful) way to clear a lane.
5. **Losing a life clears the bar** rather than only the offending lane. It
   gives the player a readable beat to recover in, and keeps the rule to one
   sentence.
6. **Mugs and empties pass through each other.** They are on the same counter
   but never collide; only customer↔mug and bartender↔empty interactions exist.
7. **No tip/bonus round.** The cabinet's bonus stage is out of scope; the wave
   bonus is a flat 200 points.
