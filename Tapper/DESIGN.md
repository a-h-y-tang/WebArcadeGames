# Tapper — Design

## Game concept

A single-screen, lane-based service arcade game on an HTML5 canvas. You are the
barkeep of a four-counter saloon. Thirsty customers walk in at the far end of
each bar and shuffle steadily toward the taps where you stand. Slide a full mug
down a bar and the nearest customer catches it, drinks, and is shoved back toward
the door. Push a customer past the far end and they leave happy — but every mug
they empty comes sliding straight back at you, and glass that reaches the taps
unattended hits the floor.

The tension is that all four bars are live at once and you can only be at one of
them: pouring on the top bar while an empty is rattling back down the bottom one
is how rounds end. Nothing else in this repo uses the serve-and-return lane
mechanic — it is a genuinely different shape of play from the maze, shooter and
puzzle titles already here.

## World geometry

Everything is derived from a handful of x-positions along a fixed set of bars, so
the layout is easy to reason about and to assert on in tests.

| Constant | Value | Meaning |
|---|---|---|
| `CANVAS_W` × `CANVAS_H` | 640 × 460 | canvas size |
| `LANES` | 4 | number of bars |
| `LANE_Y` | 95, 190, 285, 380 | y of each bar's sliding surface |
| `BAR_LEFT` | 40 | far end: customers walk in here |
| `BAR_RIGHT` | 560 | near end: the taps |
| `BARKEEP_X` | 596 | where the barkeep stands, past the taps |

Derived thresholds, all on the same axis:

| Threshold | Value | Meaning |
|---|---|---|
| `SPAWN_X` | `BAR_LEFT + 8` | a new customer steps up to the bar |
| `LEAVE_X` | `BAR_LEFT - 8` | pushed past here, a customer leaves happy |
| `MUG_START_X` | `BAR_RIGHT - 8` | a poured mug leaves the tap |
| `GRAB_X` | `BAR_RIGHT - 10` | a customer this far along grabs you |
| `CATCH_X` | `BAR_RIGHT - 12` | the barkeep's reach for returning glassware |
| `SMASH_X` | `BARKEEP_X` | glass past the barkeep hits the floor |

## Mechanics

### The barkeep

The barkeep is fixed at `BARKEEP_X` and only ever changes bar. Each `↑`/`↓`
press moves exactly one bar (key repeat is ignored), clamped to the four
counters. Being on a bar is what lets you catch returning glassware and tips —
there is no separate catch button.

### Pouring

`Space` pours: a full mug appears at the tap on the barkeep's current bar and
slides toward the far end at `MUG_SPEED` (230 px/s). The tap has a
`POUR_COOLDOWN` (0.25 s) so a held key cannot flood a bar.

### Serving

A sliding mug is taken by the rightmost customer on that bar whose body it
reaches (`CATCH_R` = 17 px from the customer's centre). On being served the
customer:

- switches to `drinking` for `DRINK_TIME` (2 s), during which they are pushed
  back at `DRINK_SPEED` (95 px/s) — roughly 190 px per mug, and a fresh mug
  caught mid-drink restarts the timer, so a chain keeps them sliding;
- sends an empty glass back toward the taps at `EMPTY_SPEED` (200 px/s);
- scores `SERVE_POINTS` (50).

Customers far from the door therefore need several mugs, one after another, while
you keep the other three bars alive.

A customer pushed past `LEAVE_X` leaves happy: `LEAVE_POINTS` (200) and one off
the level's quota. Every `TIP_EVERY`-th (4th) happy customer leaves a tip coin
that rolls back toward the taps; catching it is worth `TIP_POINTS` (300) and
missing it costs nothing.

### Losing a life

Three ways, all of them your fault:

1. A customer reaches `GRAB_X` — you were never quick enough on that bar.
2. A poured mug reaches `BAR_LEFT` with nobody to catch it — a wasted pour.
3. An empty glass (never a tip) passes `SMASH_X` while you are on another bar.

Losing a life freezes play for `DEATH_PAUSE` (1.5 s), then clears every bar and
resumes. Level progress (`served`) is kept, and because customers are spawned
while `served + customers.length` is below the quota, anyone lost in the clear-out
simply walks back in.

### Levels

A level needs `customersForLevel(level)` = `5 + level` happy customers. It clears
once the quota is met and no customers or full mugs remain, pauses for
`CLEAR_PAUSE` (1.6 s), then starts the next one with a bigger crowd that walks
faster (`customerSpeed()` = `22 + 4 × (level − 1)`, capped at 55 px/s) and
arrives more often (`spawnInterval()` = `2.0 − 0.15 × (level − 1)`, floored at
0.8 s). The cap matters: it keeps `customerSpeed()` below `DRINK_SPEED`, so a
sustained chain of mugs always gains ground on a customer and no board can
become impossible to clear. Serving one mug at a time stops being enough at
around level 7 — that is where the game asks you to chain.

The best score is persisted in `localStorage` under `tapper-best`.

## Controls

| Input | Action |
|---|---|
| `↑` `↓` / `W` `S` | move between bars |
| `Space` | pour a mug (also starts the game when idle or after game over) |
| `Enter` | start / restart |
| `P` | pause / resume |
| Start button | start, restart, or resume from pause |

## Code structure

A single classic (non-module) script, `game.js`, matching the rest of the repo so
that state and helpers are reachable from Playwright as plain globals:

- **Layout** — `LANE_Y`, `BAR_LEFT`/`BAR_RIGHT`, `BARKEEP_X` and the derived
  thresholds above.
- **State** — `state` (`idle` | `running` | `paused` | `dying` | `levelclear` |
  `over`), `score`, `best`, `lives`, `level`, `served`, `barkeep`, `customers`,
  `mugs`, `empties`, `tips`.
- **Simulation** — `step(dt)` advances spawning, customers, mugs, empties, tips
  and timers in that order, bailing out as soon as a smash ends the round.
  `requestAnimationFrame` only supplies `dt` and calls `draw()`, so no game logic
  depends on wall-clock timing.
- **Test seams** — `startGame()`, `togglePause()`, `pour()`, `placeBarkeep(lane)`,
  `spawnCustomer(lane, x)`, `spawnEmpty(lane, x)`, `spawnTip(lane, x)`,
  `remaining()`, `serveEveryoneForTest()`, and the `spawnEnabled` flag that
  silences arrivals for deterministic runs.

## Testing

`tests/tapper.spec.js` holds 69 Playwright specs covering the idle screen, start
paths, barkeep movement and clamping, pouring and the tap cooldown, customer
advance/serve/leave, the three ways to lose a life, empty-mug catching, tips,
level progression, pause, best-score persistence and rendering in every state.
They were written before the implementation and drive the simulation through
`step(dt)` rather than real time, so nothing races the animation loop.

## Assumptions

These were resolved without being able to ask; the simpler reading was taken each
time.

1. **Branch name.** The task asked for a branch named after the game (`tapper`),
   but this session's standing instructions pin all development to
   `claude/loving-euler-rvrdms` and forbid pushing anywhere else. The pinned
   branch wins; no `tapper` branch was created.
2. **Not a clone.** Sprites, layout, timings and scoring are original; only the
   genre mechanic is borrowed. Everything is drawn with canvas primitives, in
   keeping with the rest of the repo, and nothing is themed as alcohol — it is a
   soda fountain.
3. **The barkeep only changes bar.** In the original the barkeep runs along each
   counter to collect glasses. Here the taps and the catch point are the same
   place, so lane changes are the only movement — one bar per key press, no
   repeat, which keeps the input model and the specs simple.
4. **Pour is one press, one mug.** The original fills a mug while you hold the
   button and slides it further the fuller it is. A press pours one full mug at a
   fixed speed instead, with a short cooldown standing in for the fill time.
5. **A drinking customer can still catch a mug.** No special case: whichever
   customer the mug reaches first takes it, drinking or not.
6. **Every level uses the same four bars.** Difficulty comes from crowd size,
   walking speed and arrival rate rather than new layouts, which keeps levels
   testable and the code small.
7. **No bonus stage or dropped-tray hazards.** The classic bonus round and the
   distracting dancer are omitted; the tip coin is the one bonus, and it is
   deterministic (every 4th happy customer) rather than random, so it can be
   tested.
8. **`Space` is overloaded.** It pours while playing and starts the game when
   idle or after a game over. `Enter` always starts, so nothing is unreachable.
