# Tapper — Design

## Game concept

A single-screen, four-lane serving game on an HTML5 canvas. You work the tap end
of four long bars. Customers push in through the door at the far end of each bar
and walk steadily towards you; reach the taps and they haul you over the counter.
Your only weapon is a full mug: pour one and it slides away down the bar, and
whoever catches it is shoved back while they drink. Shove a customer clean off
the far end and they leave happy. Every mug they finish comes sliding straight
back at you — be standing at that bar to catch it, or it shatters on the floor.
Pour when nobody is there to catch it and the mug smashes at the far end instead.
All three mistakes cost a life, and you have three.

The pull of the game is that your one tool is also your main way to lose. A mug
poured too early smashes; a mug poured too late lets a customer reach you; and
every mug you do land comes back as an empty that pins you to that bar for a
moment while the other three fill up.

Nothing else in this repo works on the "fire a projectile that must then be
caught on the return trip" idea — the existing lane games (Kaboom!, Frogger,
Frostbite) are about dodging or catching alone, never both ends of the same
object — so this is a genuinely new shape of play here.

## World geometry

The whole board is derived from a handful of constants so the layout is easy to
reason about and to assert on in tests.

| Constant | Value | Meaning |
|---|---|---|
| `CANVAS_W` × `CANVAS_H` | 640 × 460 px | canvas size |
| `LANE_COUNT` | 4 | bars, index 0 (top) … 3 (bottom) |
| `LANE_TOP` / `LANE_SPACING` | 92 / 96 px | `laneY(l) = 92 + 96 l` → 92, 188, 284, 380 |
| `BAR_LEFT` / `BAR_RIGHT` | 48 / 600 px | the ends of a counter |
| `TAP_X` | 592 px | where mugs are poured and empties are caught |
| `SPAWN_X` | 54 px | where an arriving customer steps up to the bar |
| `LEAVE_X` | 34 px | pushed back this far and the customer leaves served |
| `WASTE_X` | 42 px | a full mug nobody caught smashes here |
| `GRAB_X` | 566 px | a customer reaching here grabs the bartender |

Everything lives on one of the four lanes and moves only in x, so collisions are
one-dimensional: a mug and a customer interact when they are on the same lane and
within `CATCH_DIST` (`CUST_HW + MUG_HW` = 23 px) of each other.

## Mechanics

### The bartender

The bartender occupies a lane, not a position: `↑`/`↓` (or `W`/`S`) step one lane
at a time, clamped to 0…3, and only while the game is running. Everything he does
— pouring, catching — happens at `TAP_X` on his current lane.

### Pouring

`pour()` puts a full mug on the bartender's lane at `TAP_X - 8`, moving left at
`MUG_SPEED` (280 px/s). Two limits keep the tap from being spammed:

- `POUR_COOLDOWN` (0.2 s) between pours, counted down in `step()`.
- `MAX_FULL_PER_LANE` (3) full mugs on any one bar at a time.

A full mug that reaches `WASTE_X` with nobody to catch it smashes and costs a
life. That is the price of over-pouring.

### Catching a mug (customers)

`catcherFor(mug)` picks the customer to receive a sliding mug: same lane, not
already drinking, and with the mug inside the window `[c.x, c.x + CATCH_DIST]`.
Two consequences fall out of that window:

- **Direction matters.** The window starts at the customer's own x, so a mug is
  only caught while it is still sliding *towards* someone. Once it has slipped
  past, it is out of reach — a customer who drains their last mug at that exact
  moment cannot reach backwards and grab it.
- **Drinkers are transparent.** A customer mid-drink has no free hand, so the mug
  slides past them to whoever is behind. Sending a second mug down a bar while
  the front customer drinks is how you reach the one further back.

When several customers are eligible the one nearest the taps (largest x) catches
it, which is the one you most want served.

The window is 23 px wide and the fastest a mug can move in one frame is 14 px
(280 px/s × the 0.05 s dt cap), so a mug can never tunnel through a customer.

### Drinking, pushback and leaving

Catching a mug sets `drinking`, bumps `drinkCount` and sets
`pushTarget = x - PUSHBACK` (96 px). While drinking the customer slides left at
`PUSH_SPEED` (150 px/s) until they reach that target, then stands still for
`DRINK_DWELL` (0.8 s) before releasing the empty and resuming their walk.

- Slide below `LEAVE_X` at any point and the customer is **served**: removed,
  `SERVE_POINTS` (100) scored, and no empty comes back.
- Otherwise the finished customer spawns an empty mug at their own x, travelling
  right at `EMPTY_SPEED` (190 px/s), and starts walking at you again.

So how many mugs a customer costs you depends on how far up the bar they got
before you served them — one near the door, three or four if you let them walk.
There is no separate thirst counter; the pushback distance *is* the difficulty.

### Catching an empty

An empty mug that reaches `TAP_X` is resolved on the spot: if the bartender is on
that lane it is caught for `CATCH_POINTS` (50); otherwise it smashes and costs a
life. This is the game's central tension — every customer you serve but do not
finish off sends back a mug that demands you be in a particular place at a
particular time.

### Losing a life

Three things cost a life: an empty smashing at the taps, a full mug smashing at
the far end, and a customer reaching `GRAB_X`. Each calls `loseLife()`, which
scatters a few glass shards, decrements `lives` and either ends the run
(`state = 'over'`) or enters `dying` for `DEATH_PAUSE` (1.2 s). The update
functions return `true` after a life loss so the rest of the frame is abandoned
and two mistakes can never be charged in one step. Play resumes with the bar
wiped and the current level's wave restarted.

### Waves and levels

A level queues `levelCustomers(level)` = `6 + 2(level − 1)` customers, released
one at a time on a timer (`spawnInterval` shrinks from 2.4 s towards 0.9 s) onto
a lane picked by `pickLane()`, which prefers a bar whose doorway is clear so
arrivals do not stack. Customers walk at `customerSpeed(level)` = 30 px/s rising
by 6 per level to a cap of 78.

When the queue is empty and the bar is clear, the level is over: `LEVEL_BONUS ×
level` is scored, a `levelclear` banner shows for `CLEAR_PAUSE` (1.5 s), and the
next wave starts. There is no final level — the game ends when your lives do.

## Controls

| Input | Action |
|---|---|
| `↑` `↓` / `W` `S` | move to the bar above / below |
| `Space` | pour a mug (also starts the game when idle or after game over) |
| `Enter` | start / restart |
| `P` | pause / resume |
| Click / tap a bar | move to that bar; click your own bar to pour |

## Code structure

`index.html` (markup and HUD), `style.css` (frame, HUD, overlay) and `game.js`
(everything else) — no build step, no modules, no dependencies. `game.js` is a
classic script, so its state and helpers are plain globals reachable from the
Playwright specs, matching BurgerTime, Kaboom! and Snake in this repo.

The file is laid out as: constants → state → helpers → spawning → simulation
(`step`) → player actions → run structure → drawing → HUD/overlay → input →
`requestAnimationFrame` loop → init.

All motion is expressed per second and applied in `step(dt)`, so the tests can
simulate exact frame counts without depending on wall-clock timing. `step(dt)`
handles the `dying` and `levelclear` countdowns first and returns; otherwise it
runs spawning, then customers, then mugs, then the wave check.

### State model

`state` is one of `idle`, `running`, `paused`, `dying`, `levelclear`, `over`.
Only `running` simulates; `dying` and `levelclear` tick their own timers, which
is what freezes the board during a banner.

### Test seams

Two globals exist purely so the specs can own the clock:

- `spawnEnabled` — turns wave spawning off, so a spec can place exactly the
  customers it wants to reason about.
- `autoStep` — leaves the animation loop painting but stops it advancing the
  simulation, so `step(dt)` is only called from the spec. Without it the real
  `requestAnimationFrame` loop advances the game by an unpredictable amount
  between two `page.evaluate` round trips, which made timing-sensitive specs
  flaky. One spec deliberately leaves it on and asserts the loop does advance
  the game, so the loop itself stays covered.

Both default to normal play; nothing in the shipped game switches them.

`seedRng()` / `rng()` are a small LCG used for lane choice and cosmetic jitter,
so a run can be made reproducible by seeding it by hand.

## Tests

`tests/tapper.spec.js` drives the real page through Playwright over `file://` —
no server, matching the rest of the repo. 61 specs cover the initial state,
starting, bartender movement, pouring (cooldown and per-bar limit), catching and
drinking (including the direction rule and sliding past a drinker), serving and
scoring, catching empties, all three ways to lose a life, the death pause, game
over and restart, waves and levels, pausing, the HUD readouts, best-score
persistence, the animation loop, and that the canvas is actually painted.

## Assumptions

Ambiguities were resolved towards the simpler reading and are recorded here.

1. **Branch name.** The task asked for a branch named after the game
   (`tapper`), but this session's standing instructions pin all work to the
   assigned branch `claude/compassionate-ramanujan-3ypeoq`. The assigned branch
   wins; no differently-named branch was pushed.
2. **No tips or bonus items.** The original arcade game drops coin tips that
   distract customers and adds a between-level "guess the untouched can" round.
   Both are omitted: they are separate mini-mechanics, and the core serve/catch
   loop stands on its own.
3. **One bar layout for every level.** Levels differ by wave size, walking speed
   and arrival rate only — there are no per-level themes or bar shapes.
4. **Pushback instead of a thirst counter.** A customer is not given a number of
   mugs they must drink; each mug shoves them a fixed distance and they leave
   when shoved off the end. How many mugs they cost you therefore depends on
   where you caught them, which is the same difficulty curve with less state.
5. **Served customers return no mug.** A customer shoved off the far end leaves
   with the mug rather than sliding an empty back. Finishing someone off is
   meant to be the clean outcome.
6. **Empty mugs pass through customers.** An empty sliding back to the taps
   ignores everybody on the bar. Modelling it as something customers could
   intercept would add a second collision system for no gameplay gain.
7. **Empties are resolved at a line, not a hitbox.** An empty reaching `TAP_X`
   is caught or smashed immediately based on the bartender's lane at that
   instant, rather than needing an overlap test against a bartender sprite.
8. **Three full mugs per bar.** A cap was needed to stop a player carpeting a
   bar with mugs; three is enough to reach a customer behind a drinker without
   making the tap a machine gun.
9. **Restart the level after a death.** Losing a life re-queues the whole
   current wave rather than resuming mid-wave, which keeps the board readable
   after the death banner.
10. **The game browser's stale e2e counts were left alone.**
    `game-browser/e2e/game-browser.spec.ts` hard-codes a game count that was
    already out of date before this game was added (it expects 105 against 116
    entries), and it is not part of the root `npm test` run. Fixing that count
    is a separate change from adding a game.
