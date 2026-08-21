# Soda Tapper — Design

## Concept

Soda Tapper is a single-screen arcade game about serving drinks under pressure. You
are the bartender at the right-hand end of four parallel counters. Thirsty
customers push in from the left end of each counter and walk steadily toward you.
Slide a full mug down a counter and the customer at the far end catches it,
staggers back a few steps while drinking, and shoves the empty mug back at you.

You have to do three things at once:

1. Keep every advancing customer pushed back before they reach your end of the bar.
2. Catch every empty mug that comes sliding back.
3. Not waste mugs — a full mug that reaches the far end of an empty counter falls
   off and smashes.

Serve everybody on the level and the next shift starts: more customers, arriving
faster, walking quicker.

This is a homage to the 1983 arcade cabinet of the same genre, rebuilt from
scratch as a canvas game. No original assets or code are used — everything is
drawn procedurally with `CanvasRenderingContext2D` primitives.

## Board layout

The canvas is 640×480.

- Four counters (lanes), counter surfaces at y = 118, 212, 306, 400.
- Each counter runs from `BAR_LEFT` (x = 70) to `BAR_RIGHT` (x = 566).
- The bartender stands to the right of `BAR_RIGHT` and occupies exactly one lane
  at a time.
- Customers enter at `BAR_LEFT` and advance to the right.
- Full mugs travel right-to-left; empty mugs travel left-to-right.

## Mechanics

### Serving

Pressing <kbd>Space</kbd> pours a mug into the bartender's current lane. The mug
spawns at `BAR_RIGHT` and slides left at `MUG_SPEED` (260 px/s). A short cooldown
(`SERVE_COOLDOWN` = 0.18 s) keeps a held key from emptying the tap in one frame.

### Customers

A customer is either `advancing` or `drinking`.

- `advancing` — walks right at the level's customer speed.
- `drinking` — stands still for `DRINK_TIME` (0.7 s), then resumes advancing.

When a full mug overlaps an advancing customer, the customer catches it:

- the mug is removed and the player scores `SCORE_SERVE` (50),
- the customer is pushed `PUSH_BACK` (86 px) to the left and starts drinking,
- an empty mug is spawned at the customer's position, sliding right.

If the push-back takes a customer to or past `BAR_LEFT`, that customer is
satisfied and leaves the bar for `SCORE_CLEAR` (100) — that counts toward the
level's served total.

### Empty mugs

An empty mug slides right at `EMPTY_SPEED` (200 px/s). When it reaches
`BAR_RIGHT`:

- bartender is in that lane → caught, `SCORE_CATCH` (25) points;
- bartender is elsewhere → the mug falls off the end and the player loses a life.

### Losing a life

Three separate mistakes cost a life:

- an empty mug reaches the bartender's end of a lane he is not standing in,
- a full mug reaches `BAR_LEFT` with no customer to catch it,
- a customer reaches the bartender's end of the bar.

In each case the offending entity is removed, `lives` drops by one, and a short
`FLASH_TIME` highlight marks the lane. At zero lives the game ends and the
overlay shows the final score; the best score is kept in `localStorage` under
`sodatapper-best`.

### Levels

Level *n* sends `4 + 2n` customers (capped at 14), with spawn interval and
customer speed both scaling with the level:

```
customerSpeed = CUSTOMER_SPEED_BASE + (level - 1) * CUSTOMER_SPEED_STEP
spawnInterval = max(SPAWN_MIN, SPAWN_BASE - (level - 1) * SPAWN_STEP)
```

The level is complete once every customer for that level has spawned, been
served, and no customer, full mug or empty mug is left on the bar. A short
`LEVEL_PAUSE` interlude shows "SHIFT COMPLETE" before the next level starts.

## Controls

| Input | Action |
|---|---|
| <kbd>↑</kbd> / <kbd>W</kbd> | Move up one counter |
| <kbd>↓</kbd> / <kbd>S</kbd> | Move down one counter |
| <kbd>Space</kbd> | Pour and slide a mug (also starts/restarts the game) |
| <kbd>P</kbd> | Pause / resume |
| Start button | Start, resume from pause, or restart |

## Code structure

Plain scripts, no build step, matching the rest of the repository:

- `index.html` — HUD (score, level, lives, served, best), canvas, overlay, help.
- `style.css` — dark arcade styling.
- `game.js` — all game logic as top-level globals and functions so Playwright can
  drive the simulation directly.

The simulation is a pure function of `step(dt)`, kept separate from `draw()` and
from `requestAnimationFrame`. Tests call `step(dt)` themselves for exact,
frame-rate-independent control, and set `spawnEnabled = false` to stop the level's
own spawner from interfering with a scripted scenario. They also set
`autoStep = false`, which stops the animation frame loop from stepping the
simulation, leaving `step(dt)` calls from the spec as the only source of time.

Test-facing globals: `state`, `score`, `lives`, `level`, `served`, `bartender`,
`mugs`, `empties`, `customers`, `spawned`, `levelTotal`, `customerSpeed`,
`spawnInterval`, `spawnEnabled`, `autoStep`, `startGame()`, `step(dt)`, `draw()`,
`serve()`, `spawnCustomer(lane)`, `togglePause()`.

`state` is one of `idle`, `running`, `paused`, `interlude`, `over`.

## Assumptions

Decisions made without a human to ask, all resolved toward the simpler reading:

- **Branch name.** The task asked for a branch named after the game
  (`soda-tapper`), but this session is pinned to the designated branch
  `claude/loving-euler-uw2wos` and instructed never to push elsewhere. The work
  lives on the designated branch; the game name is carried by the folder instead.
- **Bartender movement is instant per lane**, not a smooth glide. It makes the
  game read cleanly at four lanes and makes tests deterministic.
- **No tip glasses, no bonus round.** The original cabinet has a bonus stage
  (guess which can was not shaken) and dropped tips that pull customers back.
  Both are omitted; the core loop stands on its own.
- **No per-lane mug limit.** The serve cooldown is the only throttle.
- **Losing a life does not reset the lane.** Play continues with whatever is
  still on the bar, which keeps the failure state legible.
- **A customer pushed off the left end is "served".** There is no separate
  "drinks needed" counter: how many mugs a customer costs falls out of how far
  they have walked, so a customer met near the door goes home on one mug while
  one who has reached your end of the bar takes five or six.
- **Spawn lanes are least-crowded-first**, with `Math.random` breaking ties, so a
  shift cannot dump its whole queue into one counter. Tests never rely on the
  randomness; they disable the spawner and place customers explicitly.
- **Screenshot.** A `screenshot.png` thumbnail is captured from the running game
  so the game browser card matches the other entries.
- **Game browser card counts.** `game-browser/e2e/game-browser.spec.ts` asserts a
  literal number of game cards. It already disagreed with `games.json` before
  this change (105 asserted against 108 entries), so it was updated to the true
  post-change total of 109 rather than left further adrift.
