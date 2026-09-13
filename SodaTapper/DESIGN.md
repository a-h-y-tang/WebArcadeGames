# Soda Tapper — Design

## Concept

A one-screen arcade game about running a soda fountain with four bars and not
enough hands. Thirsty patrons push in from the left end of each bar and walk
steadily toward the taps on the right. You are the server, standing at the tap
end, and you can only be on one bar at a time.

Slide a full mug down a bar and it knocks the nearest patron back while they
drink. Keep knocking them back until they are pushed off the left end of the
bar — that's a sale. But every patron who leaves slides their empty mug back
toward you, and an empty that reaches the taps with nobody there smashes on
the floor. Miss a patron with a mug and it smashes at the far end too. Let a
patron reach the taps and they grab you over the counter.

Three mistakes and the shift is over. Survive a round's worth of customers and
the next round is bigger and faster.

## Mechanics

### The bars

Four horizontal bars (lanes) run from `BAR_LEFT` (x = 70) to `BAR_RIGHT`
(x = 580) on a 640×420 canvas. The server stands past the right end of the bar
and occupies exactly one lane at a time.

### Patrons

| State | Behaviour |
|---|---|
| `advancing` | Walks right at the round's patron speed. |
| `drinking` | Stands still for `DRINK_TIME` after being hit by a mug. |
| `retreating` | Slides left at `RETREAT_SPEED` until `PUSH_DIST` of ground is given up, then goes back to `advancing`. |

* A patron that reaches `GRAB_X` (30px short of the tap end) grabs the server:
  the patron is removed and a life is lost.
* Every mug a patron drinks makes them keener: their walking speed is multiplied
  by `DRINK_SPEEDUP` (capped at twice `PATRON_SPEED_MAX`). Knocking the same
  customer back over and over therefore gets harder each time, which is what
  stops "hold the line" from being a viable alternative to actually selling.
* A patron pushed to `BAR_LEFT` or beyond leaves the bar: `EXIT_POINTS` are
  scored, the round's served counter goes up, and the patron drops an empty mug
  at the left end that slides back to the right.

### Mugs

* `pour()` puts a full mug at the tap end of the server's current lane. It
  slides left at `MUG_SPEED`. There is a `POUR_COOLDOWN` between pours so a
  held key cannot carpet a lane.
* A full mug collides with the right-most *advancing* patron in its lane within
  `HIT_DIST`. On a hit the mug is consumed, `SERVE_POINTS` are scored, and the
  patron starts drinking and is then pushed back.
* A patron who is drinking or sliding back has their hands full: the mug slides
  straight past them. That is what keeps a held key from farming points off one
  customer — every wasted mug runs on to the far end and costs a life.
* A full mug that reaches `BAR_LEFT` without hitting anybody smashes: one life.

### Empty mugs

* Slide right at `EMPTY_SPEED` from the left end of the lane they were left in.
* When an empty reaches `CATCH_X`, it is caught if the server is in that lane
  (`CATCH_POINTS`), and smashed for a life if not.

### Rounds

Round *n* sends `4 + 2n` patrons. The round ends when all of them have been
served and the bar is clear; that scores `LEVEL_POINTS`, bumps the level, makes
patrons faster (`PATRON_SPEED_BASE + level * PATRON_SPEED_STEP`, capped) and
shortens the gap between arrivals. Lives are *not* refilled between rounds.
A banner is drawn over the play field for a moment at the start of each round;
it does not pause play.

### Losing

`START_LIVES` (3) mistakes end the shift. The best score is kept in
`localStorage` under `soda-tapper-best`.

## Controls

| Input | Action |
|---|---|
| <kbd>↑</kbd> / <kbd>W</kbd> | Move up one bar |
| <kbd>↓</kbd> / <kbd>S</kbd> | Move down one bar |
| <kbd>Space</kbd> | Pour and slide a mug (also starts / restarts the game) |
| <kbd>P</kbd> / <kbd>Esc</kbd> | Pause / resume |

## Code structure

Written as a single classic (non-module) script, matching Lode Runner, Kaboom
and Tetris in this repo, so that state and logic are reachable from the
Playwright tests as plain globals.

* `SodaTapper/index.html` — HUD, canvas, overlay, help text.
* `SodaTapper/style.css` — presentation only.
* `SodaTapper/game.js` — constants, state, `step(dt)`, `draw()`, input.

The whole simulation is advanced by `step(dt)`. The `requestAnimationFrame`
loop only calls `step()` when `autoStep` is on, so tests turn it off with
`setAutoStep(false)` and drive the world frame by frame — no wall-clock
dependence anywhere in the suite. Drawing and HUD updates still run on the rAF
loop so rendering stays under test too.

### Hooks used by the tests

| Hook | Purpose |
|---|---|
| `setAutoStep(bool)` | Detach the simulation from `requestAnimationFrame`. |
| `step(dt)` | Advance one frame of `dt` seconds (no-op unless running). |
| `setSpawnEnabled(bool)` | Stop the automatic arrival of patrons. |
| `spawnPatron(lane, x)` | Place one patron exactly where a test needs it. |
| `clearEntities()` | Empty the patron / mug / empty arrays. |
| `pour()`, `moveLane(dir)`, `startGame()`, `togglePause()` | Drive the game without keyboard events. |

State is exposed as the globals `state`, `score`, `best`, `lives`, `level`,
`served`, `patrons`, `mugs`, `empties`, `server`, plus the tuning constants.

## Balance

The tuning constants were not guessed. A scripted bot plays the game headlessly
through the same `step(dt)` the tests use, and three rounds of that playtesting
drove real changes:

1. A bot holding the pour key farmed thousands of points off one customer it
   kept re-serving → mugs now only catch *advancing* patrons.
2. A bot that always knocked back whichever patron was furthest along could hold
   a crowd forever, scoring on every hit without ever making a sale → the hit
   bonus dropped from 50 to 10, the sale rose from 100 to 150, and each drink
   now makes that patron faster, so the stalemate decays.
3. Arrivals outpaced any possible service rate from round 6 on, so rounds became
   unfinishable → the gap between arrivals now floors at 2.6s, comfortably above
   the ~4s it takes to close a sale early on and closing slowly after that.

With those in place a near-perfect player clears a round roughly every 35
seconds and runs out of room somewhere around round 11; the difficulty comes
from patron speed and from empties piling up on bars you have left behind.

## Assumptions

These were the ambiguous points; the simpler reading was taken each time and is
recorded here.

1. **Branch name.** The task asked for a branch named after the game
   (`soda-tapper`), while the session's standing git instructions designate
   `claude/compassionate-ramanujan-p4yy0o` and forbid pushing anywhere else.
   The designated branch wins, since pushing to an undesignated branch is the
   irreversible half of the conflict.
2. **Pouring is one key press, not a hold.** The arcade original fills a mug
   while the handle is held and slides it on release. A press-to-slide mug with
   a short cooldown keeps the input model simple and keeps the tests free of
   timing-sensitive key-hold simulation.
3. **A mistake costs a life but does not clear the bar.** The original wipes the
   screen and restages the round. Here only the offending patron or mug is
   removed, which keeps the round's served/quota bookkeeping simple.
4. **Only an advancing patron can be hit by a mug.** The first cut let a mug hit
   anybody, and a scripted playtest immediately showed why that is wrong: a bot
   holding the pour key farmed thousands of points off a single customer it kept
   re-serving. Mugs now slide past drinkers, so careless pouring costs a life
   instead of paying out.
5. **A patron pushed off the left end is a sale**, however far along the bar
   they were. So a patron met early needs one mug and one met late needs
   several, which is the intended difficulty curve.
6. **Round transitions do not pause the game.** A banner is drawn for
   `BANNER_TIME` seconds while play continues, rather than a modal interlude.
7. **Lives are not restored between rounds**, so the run has a real arc.
8. **The server moves a whole lane per key press** (no smooth vertical travel
   for collision purposes); the sprite lerps toward the lane only for looks.
