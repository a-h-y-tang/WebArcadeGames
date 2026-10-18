# Soda Tapper — Design

## Game concept

Soda Tapper is a single-screen reflex game about running the busiest soda
fountain in town. Four bars stretch away from the taps on the left-hand side of
the screen. Thirsty patrons walk in from the far right end of each bar and
march steadily toward you. The only thing that stops them is a frosty mug:
fill one at the tap and slide it down the bar, and the patron who catches it is
shoved back toward the door while they drink.

Mugs are not free of consequence. A mug slid down an empty bar sails off the
far end and smashes on the floor. Every mug a patron finishes is sent sliding
back toward the taps, and you have to be standing in that lane to catch it —
an empty mug that reaches the taps unattended smashes too. Each smash, and
every patron who makes it all the way to the taps, costs a life.

Push a patron off the far end of the bar and they leave happy, which is how
rounds are cleared. Serve a round's worth of patrons without losing all three
lives and the next round brings faster, more frequent custom.

## Playfield and geometry

| Constant | Value | Meaning |
|---|---|---|
| `CANVAS_W` × `CANVAS_H` | 720 × 460 | canvas size in CSS pixels |
| `LANE_COUNT` | 4 | number of bars |
| `LANE_TOP` | 70 | centre line of the first bar |
| `LANE_GAP` | 100 | vertical distance between bar centre lines |
| `TAP_X` | 90 | x of the taps — where the bartender stands |
| `BAR_RIGHT` | 690 | far end of every bar; patrons enter here |
| `CATCH_X` | 118 | an empty mug at or left of this x can be caught |
| `SMASH_X` | 70 | an empty mug left of this x has smashed |
| `GRAB_X` | 116 | a patron at or left of this x has reached the taps |
| `FOOTER_Y` | 408 | top of the strip holding the lives and round progress |

Lane `i` is drawn at `LANE_TOP + i * LANE_GAP`, so the four bars sit at
y = 70, 170, 270 and 370. The bartender never moves horizontally — only
between lanes — so his position is just `bartender.lane`.

## Mechanics

### Entities

`patrons` and `mugs` are plain arrays of objects, rebuilt on every round.

A patron is `{ lane, x, phase, timer }`. `phase` is `'walking'` while they
advance toward the taps at the round's `patronSpeed`, or `'drinking'` while
they stand still working through a mug.

A mug is `{ lane, x, full }`. A full mug travels right at `MUG_SPEED`
(300 px/s); an empty one travels left at `EMPTY_SPEED` (240 px/s). Direction is
derived from `full` rather than stored, so a mug cannot end up travelling the
wrong way for its state.

### The serve

`serve()` is a no-op unless the game is running and `serveCooldown` has
expired. Otherwise it puts a full mug at `TAP_X + 24` in the bartender's lane
and starts a `SERVE_COOLDOWN` (0.18 s) timer, which stops a held key from
flooding a bar with mugs in a single frame.

### Collisions, in resolution order

`step(dt)` advances timers, then mugs, then patrons, and resolves in this
order so a single frame can never apply two contradictory outcomes:

1. **Full mug meets patron** — the nearest walking-or-drinking patron in the
   lane within `HIT_DIST` (22 px) catches it. The mug is removed, the patron is
   pushed `PUSH_BACK` (150 px) toward the door, their phase becomes
   `'drinking'` for `DRINK_TIME` (0.9 s) and the player scores `SERVE_POINTS`.
2. **Full mug off the far end** — a full mug past `BAR_RIGHT` smashes and
   costs a life.
3. **Empty mug at the taps** — at or left of `CATCH_X`, a mug in the
   bartender's lane is caught for `CATCH_POINTS`; one in any other lane keeps
   sliding and smashes at `SMASH_X`, costing a life.
4. **Patron at the taps** — a walking patron at or left of `GRAB_X` costs a
   life.

When a patron finishes drinking they slide the empty mug back from their own
position, and then either leave satisfied (if the push-back carried them to or
past `BAR_RIGHT`, scoring `SATISFIED_POINTS`) or resume walking. One code path
covers both, so the empty mug is always sent back exactly once per mug served.

### Reading the board

Two cues are drawn rather than simulated, because the bars alone do not carry
them in time:

- **Incoming-empty chevrons.** Each tap gets a chevron on the wall whenever an
  empty mug is heading back down its bar, brightening as the mug closes on
  `CATCH_X` and turning green once the bartender is standing in that lane. An
  empty approaching a lane you are not in is the one threat that is otherwise
  easy to lose track of while pouring somewhere else.
- **The footer strip.** Below the bars, the remaining lives are drawn as mugs
  and the round's progress as a bar: `spawned - patrons.length` of the round's
  quota have left the building one way or another.

### Rounds

`ROUNDS` is a table of five entries, each `{ patrons, patronSpeed, spawnGap,
maxActive }`. Patrons spawn on a timer into a random lane while fewer than
`maxActive` are on screen and the round's quota has not been reached. A round
is cleared once the quota has spawned, no patrons remain and no mugs are in
flight; the player banks `LEVEL_BONUS × round` and, after `CLEAR_PAUSE`, the
next round starts. Clearing round 5 wins the run.

### Losing a life

Any smash or grab calls `loseLife()`: all mugs are cleared off the bars and
every surviving patron is sent back to the door, which is this game's
equivalent of the arcade original restarting the round. `state` becomes
`'dying'` for `DEATH_PAUSE` (1.1 s) and then returns to `'running'`. With no
lives left the run ends, the overlay shows the final score, and the best score
is written to `localStorage` under `sodatapper-best`.

## States

`state` is one of `idle`, `running`, `dying`, `paused`, `levelclear`,
`gameover`, `won`. `step(dt)` ignores every state except `running`, `dying`
and `levelclear`, so pausing genuinely freezes the simulation rather than
hiding it.

## Controls

| Input | Action |
|---|---|
| `↑` `↓` / `W` `S` | move between bars |
| `Space` | start, serve a mug, or dismiss an overlay |
| `P` | pause and unpause |
| Click a bar | move to that bar and serve |

## Code layout

The game is a single classic (non-module) script, matching Gold Runner, Snake
and Tetris in this repository: every piece of state and every helper is a plain
global, so the Playwright suite can read `patrons`, `mugs` and `state`
directly and drive time with `step(dt)`. All motion is expressed per second
and applied through `step(dt)`, and the requestAnimationFrame loop only calls
`step` while `autoStep` is true — the tests switch it off and advance frames
themselves, so nothing depends on wall-clock timing. A second hook,
`spawnEnabled`, stops the door: with it off a spec can put exactly the patrons
it cares about on the bars and know nothing else will wander in between
assertions.

- `index.html` — page shell, HUD, canvas and overlay
- `style.css` — cabinet styling
- `game.js` — simulation and rendering
- `tests/soda-tapper.spec.js` — Playwright suite

## Assumptions

Decisions made without a human to ask, each resolved toward the simpler
reading:

- **Branch name.** The task asked for a branch named after the game
  (`soda-tapper`), but this session is configured to develop and push on
  `claude/compassionate-ramanujan-3r6lid`. The session's designated branch
  wins, since pushing elsewhere is explicitly disallowed.
- **Pouring is a single press.** The arcade original has you hold the tap to
  fill a mug and release to slide it. Here `Space` pours and slides in one
  press, with a short cooldown instead of a fill meter.
- **The bartender is fixed at the taps.** Only vertical movement exists, so
  there is no "walk back to the tap" travel time.
- **One mug, one shove.** Every caught mug pushes a patron back the same
  `PUSH_BACK` distance regardless of round, so how many mugs a patron needs
  depends only on how far they have walked.
- **No tip glasses or bonus break screens.** The original's tip-jar and
  can-shuffle bonus rounds are out of scope; scoring is serves, catches,
  satisfied patrons and a round bonus.
- **Lane choice for spawns is random.** Rather than seed a generator, the
  suite turns `spawnEnabled` off and calls `spawnPatron(lane)` for the lanes it
  cares about.
- **A life loss restarts the traffic, not the round.** Patrons already served
  stay served; survivors are sent back to the door. This is simpler than
  re-running a whole round and keeps progress legible.
- **Soda, not the original's root beer branding.** The game, its art and its
  naming are generic.
