# Tapper — Design

## Game concept

A single-screen, four-lane arcade game set behind the counter of a busy tavern.
You are the bartender, penned in at the right-hand end of four parallel bars.
Thirsty patrons stream in through the doors at the far left of each bar and
shuffle steadily towards you. Your only weapon is a full mug: pull the tap and
slide a drink down the bar. A mug that reaches a patron shoves them back towards
the door and buys you a few seconds while they drink.

Every drink comes back. When a patron finishes, they slide the empty mug back up
the bar — and if you are not standing at that bar's tap when it arrives, the mug
sails off the end and shatters. Shove a patron all the way out of the door and
they leave satisfied, sometimes flipping a tip onto the bar which slides back to
you for a big bonus.

You lose a life three ways: a patron reaches you, an empty mug shatters at the
tap end, or a full mug slides off the far end of an empty bar. Serve the level's
quota of patrons to move up a level — the doors open faster and the crowd walks
quicker every time.

Nothing else in this repo uses the "two-way projectile lane" mechanic, where the
thing you fire has to be caught again on the return trip. That return-catch loop
is what makes Tapper distinct from the shooters (Space Invaders, Galaga,
Centipede) and the lane-dodgers (Frogger, Road Rush) already here.

## World geometry

Everything is derived from a handful of constants so the layout is easy to reason
about and easy to assert on in tests.

| Constant | Value | Meaning |
|---|---|---|
| `CANVAS_W` | 640 px | canvas width |
| `CANVAS_H` | 480 px | canvas height |
| `LANE_COUNT` | 4 | number of bars |
| `LANE_TOP` | 84 px | y of the first bar's surface |
| `LANE_SPACING` | 100 px | vertical distance between bars |
| `LANE_Y` | 84, 184, 284, 384 | surface line of each bar |
| `BAR_LEFT` | 44 px | the door end — patrons enter here |
| `BAR_RIGHT` | 572 px | the tap end |
| `TAP_X` | 562 px | x where a freshly poured mug appears |
| `CATCH_X` | 568 px | an empty mug or tip is caught at this x |
| `GRAB_X` | 532 px | a patron who reaches this x grabs you |

The bartender occupies a single lane at a time and is drawn to the right of
`BAR_RIGHT`. Lane changes are instantaneous (see *Assumptions*).

## Entities

### Bartender

`bartender = { lane }`. Moves between lanes 0…3 with the arrow keys or `W`/`S`.
Pulls the tap with `Space` (or `Enter`).

### Mugs

`mugs` holds every mug on the bars. A mug is
`{ lane, x, dir }` where `dir` is `-1` for a **full** mug travelling left away
from the tap, and `+1` for an **empty** mug returning to the tap.

| Constant | Value | Meaning |
|---|---|---|
| `MUG_SPEED` | 265 px/s | speed of a full mug (leftward) |
| `EMPTY_SPEED` | 300 px/s | speed of a returning empty (rightward) |
| `MAX_MUGS_PER_LANE` | 2 | full mugs allowed in flight per bar |

- A full mug that reaches `BAR_LEFT` without meeting a patron shatters → life lost.
- An empty mug that reaches `CATCH_X` is **caught** if the bartender is in that
  lane (+`CATCH_POINTS`); otherwise it shatters → life lost.

`MAX_MUGS_PER_LANE` stops the player from spamming the tap and flooding a bar
with mugs that they then cannot possibly catch on the way back.

### Patrons

`customers` holds `{ lane, x, drinking, drinkTimer, served }`. Patrons spawn at
`BAR_LEFT` and walk right at `CUSTOMER_SPEED + CUSTOMER_SPEED_STEP * (level - 1)`,
capped at `CUSTOMER_SPEED_CAP`. A drinking patron stands still.

When a full mug overlaps a patron:

1. the mug is consumed and `SERVE_POINTS` are scored,
2. the patron is shoved `PUSHBACK` px back towards the door (clamped so they
   never pass `BAR_LEFT - 10`),
3. they start drinking for `DRINK_TIME` seconds.

When the drink timer expires an empty mug appears at the patron's x heading
right. If the shove had pushed the patron to `BAR_LEFT` or beyond they leave
satisfied (+`SATISFIED_POINTS`, counts towards the level quota); otherwise they
resume walking.

A patron who reaches `GRAB_X` grabs the bartender → life lost.

### Tips

Every `TIP_EVERY`-th satisfied patron drops a tip on the bar. A tip is
`{ lane, x }` and slides right at `TIP_SPEED`. Catching it in the right lane
scores `TIP_POINTS`; missing it costs nothing — a tip is pure upside.

## Level flow

| Constant | Value | Meaning |
|---|---|---|
| `BASE_QUOTA` | 4 | quota is `BASE_QUOTA + 2 * level` patrons |
| `SPAWN_BASE` | 3.0 s | gap between arrivals at level 1 |
| `SPAWN_STEP` | 0.18 s | the gap shrinks by this much per level |
| `SPAWN_MIN` | 1.1 s | floor on the arrival gap |
| `MAX_PER_LANE` | 3 | patrons allowed on one bar at once |

A wave spawns `levelQuota` patrons one at a time. The lane is chosen by the
deterministic rotation `(spawnCursor * 3 + level) % LANE_COUNT`, skipping to the
next lane with room if the first choice is full — no RNG anywhere in the game, so
a given sequence of inputs always produces exactly the same run, which is what
makes the Playwright specs stable.

The level clears once every patron of the wave has spawned, been satisfied, and
left the bars. That awards `LEVEL_BONUS * level` and starts the next wave.

## Losing a life

`loseLife()` decrements `lives`, sweeps every mug, patron and tip off the bars,
and pauses the door for `RESPAWN_DELAY` seconds before the wave resumes. Progress
towards the level quota is kept — you do not restart the wave. At zero lives the
game ends, the overlay shows the final score, and a new best is written to
`localStorage` under `tapper-best`.

## Controls

| Input | Action |
|---|---|
| `↑` / `W` | move up one bar |
| `↓` / `S` | move down one bar |
| `Space` / `Enter` | pull the tap (and start / restart from the overlay) |
| `P` | pause / resume |
| Click **Start Game** | start |

## Code structure

Single classic (non-module) script, matching Snake, Tetris, Kaboom! and
BurgerTime in this repo, so all state and helpers are reachable from the
Playwright specs as plain globals.

- `Tapper/index.html` — HUD, canvas, overlay, help strip.
- `Tapper/style.css` — tavern palette (warm woods, brass, amber).
- `Tapper/game.js` — constants, state, `step(dt)`, `draw()`, input, main loop.

All motion is expressed per second and advanced through a single `step(dt)`
function, so tests can simulate frames deterministically instead of waiting on
`requestAnimationFrame` wall-clock timing. `frame()` only calls `step()` when the
global `autoStep` is true; the specs set `autoStep = false` immediately after
navigation so the real animation loop cannot race their simulated frames.

Order of work inside `step(dt)`: mugs → patrons → tips → spawning → level check →
HUD. Each phase returns early after `loseLife()` because that call empties every
entity array.

## Testing

`Tapper/tests/tapper.spec.js` drives the page from `file://` — no server needed —
and covers: initial/idle state, starting, bartender movement and clamping,
pouring and the per-lane mug cap, full-mug shatter, patron walking and the grab,
the serve → shove → drink → empty-mug cycle, catching and missing empties,
tips, life loss and game over, level progression, and pause.

## Assumptions

These were judgement calls made while building autonomously; each takes the
simpler of the available readings.

1. **Branch name.** The task asked for a branch named after the game
   (`tapper`), but this session is pinned to the designated development branch
   `claude/loving-euler-qmrxat` and must not push elsewhere. The designated
   branch wins; the game name lives in the folder, the commit and the PR title.
2. **Instant lane changes.** The arcade original animates the bartender running
   between bars. Here a lane change is instantaneous. It keeps the physics
   trivially deterministic for tests, and the difficulty is carried by mug and
   patron speeds instead.
3. **One shove per drink.** The original tracks how far along the bar a patron
   has come and needs several drinks to clear them. Here every mug shoves a
   fixed `PUSHBACK`, and a patron shoved to the door leaves — so patrons served
   early are cheap and patrons who get close take several mugs.
4. **No dancing-girl distraction, no bonus round.** The original's bonus stage
   and the distraction mechanic are dropped. Tips carry the "reward for
   aggressive play" role instead.
5. **Missing a tip is free.** Missing an *empty mug* costs a life; missing a tip
   does not. Punishing both made the tip a trap rather than a reward.
6. **Losing a life keeps quota progress.** The bars are swept clean but the
   count of patrons already satisfied this level is kept, so a late mistake does
   not send the player back to the start of a long wave.
7. **Full mugs hit drinking patrons too.** No special case for a patron who is
   mid-drink: the mug lands, shoves them again and restarts their timer. Fewer
   rules, and it rewards a well-timed follow-up pour.
8. **Deterministic spawning.** Lane choice and tip drops are counter-driven
   rather than random, so a replayed input sequence gives an identical game.
9. **Theme.** Drinks are drawn as generic amber mugs in a tavern; no branding of
   any kind is implied or referenced.
