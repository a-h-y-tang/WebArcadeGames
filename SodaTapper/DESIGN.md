# Soda Tapper — Design

## Concept

A single-screen service-counter arcade game in the spirit of *Tapper*. You are
the lone server behind four soda counters. Thirsty customers shuffle in from the
far end of each counter and walk towards you. The only thing you can do is slide
a full mug down the counter to meet them — and then catch the empty they shove
back at you.

Nothing about the game is forgiving: a mug that misses everybody falls off the
far end, an empty you fail to catch smashes on the floor, and a customer that
reaches your station drags you over the counter. All three cost a life.

## Board

The canvas is 720 x 480. Four counters (lanes) fill the lower 384px, each 96px
tall; the strip above them is the bar's back wall and the level banner.

```
   BAR_LEFT (40)                                 CATCH_X (640)
        |                                              |   PLAYER_X (660)
        v                                              v    v
  lane 0 |=== customer -->            <-- mug ======== | [server]
  lane 1 |                                             |
  lane 2 |                                             |
  lane 3 |                                             |
                                              BAR_RIGHT (680)
```

Everything is one-dimensional per lane: entities are an `x` (a centre, in
canvas pixels) plus a lane index, so every rule is a comparison of two numbers.
There is no free-form collision geometry anywhere in the game.

## Mechanics

**Pouring.** `Space` pours a full mug at the tap (`TAP_X`) on the server's
current lane; it slides left at `MUG_SPEED`. A `POUR_COOLDOWN` of 0.2s stops the
key from flooding the counter.

**Serving.** A full mug is taken by the right-most *advancing* customer on its
lane as soon as their bounding boxes touch. The customer is shoved back
`PUSH_BACK` pixels, their drink counter goes up, and they stop to drink for
`DRINK_TIME`. Serving a mug scores `SCORE_SERVE_MUG`.

**Empties.** Every finished drink sends an empty mug sliding back to the right
at `EMPTY_SPEED`. When it crosses `CATCH_X` the server catches it if they are
standing on that lane (`SCORE_CATCH`); otherwise it reaches the end of the
counter and shatters.

**Satisfied customers.** After `DRINKS_NEEDED` drinks a customer turns around
and leaves; walking off the left end of the counter scores `SCORE_CUSTOMER` and
counts towards the wave.

**Waves.** Level *n* has `4 + 2n` customers. They arrive on random lanes on a
timer that tightens each level. Serving the whole wave clears the level, pays a
`200 * level` bonus and starts the next one faster.

Three dials carry the difficulty, all read from the level number so there is
one place to tune:

| Dial | Level 1 | Level 10 |
|---|---|---|
| `spawnInterval()` — seconds between arrivals | 2.24s | 0.80s |
| `customerSpeed()` — pixels per second | 35 | 98 |
| `maxOnscreen()` — customers allowed on the bar | 3 | 8 (the `MAX_ONSCREEN` ceiling) |

These were set by play-testing headlessly: a scripted player that catches the
most urgent empty and otherwise pours at the customer nearest the station
coasts through the early levels, drops its first life around level 6 and is
finished by level 7 — roughly four minutes. A human, who cannot switch counters
in a single frame, peaks several levels earlier.

**Losing a life.** Three ways, each recorded in `lastLoss` so the cause can be
shown and asserted on:

| `lastLoss` | Cause |
|---|---|
| `spill`   | a full mug ran off the left end of a counter |
| `shatter` | an empty mug was not caught at the station |
| `grabbed` | a customer reached the server's end of a counter |

A life loss clears the bar; every customer still on it is returned to the wave's
spawn queue, so the level must still be completed in full. Play resumes after a
short `respawn` pause. At zero lives the game is over.

## Controls

| Input | Action |
|---|---|
| `↑` / `W` | move up one counter |
| `↓` / `S` | move down one counter |
| `Space` | pour a mug (and start/resume the game) |
| `P` | pause |
| Click canvas | pour |

## Code shape

`game.js` is a single classic (non-module) script, matching Snake, Gold Runner
and the rest of the repo, so its state and helpers are reachable from the
Playwright specs as plain globals. All motion is expressed per second and
advanced through `step(dt)`; the `requestAnimationFrame` loop only calls
`step()` while `autoStep` is true, so a test can switch it off and drive time
by hand. Drawing is a pure function of state and never mutates it.

State lives in a handful of module-level bindings — `state`, `player`, `mugs`,
`customers`, `score`, `lives`, `level`, `served`, `waveSize`, `spawned` — rather
than one object, which keeps the test assertions short.

**Randomness.** Lanes come from a small LCG rather than `Math.random`, so a run
is completely determined by `rngSeed`: a spec, or a bug report, can pin the seed
and replay the same customers frame for frame. `startGame()` seeds it from the
clock, so ordinary play still varies.

## Assumptions

Nothing here was specified, so the simpler reading was taken in each case and
recorded:

- **Branch name.** The task asked for a branch named after the game
  (`soda-tapper`), but this session is bound to the designated branch
  `claude/compassionate-ramanujan-aujyqc` and is told never to push elsewhere.
  The designated branch wins; the game name lives in the folder and commit
  message instead.
- **Theme.** The arcade original is a bar; this is a soda fountain, so the game
  has no alcohol in it.
- **Mugs pass each other.** A full mug sliding left and an empty sliding right
  on the same lane do not interact. Modelling a mid-counter collision adds a
  rule the player cannot see coming, so they slide past.
- **One catch check.** An empty is caught or lost at a single point (`CATCH_X`),
  not over a window. This makes "was the server on that lane" a single
  unambiguous test instead of a timing race.
- **Only advancing customers take a mug.** A customer who is drinking, or who is
  satisfied and walking away, ignores mugs. A mug aimed past them keeps going.
- **Lane changes are discrete.** One keypress moves one lane, with no auto-repeat
  while the key is held, so a held arrow cannot slide the server across the bar.
- **A life loss re-queues customers** rather than forgiving them, so a wave's
  customer count is the number actually served.
- **No soda stock / no bonus items.** The arcade machine has a keg that runs dry
  and tip-glass bonus rounds; both are extra systems that do not change the core
  loop, so neither is modelled.
