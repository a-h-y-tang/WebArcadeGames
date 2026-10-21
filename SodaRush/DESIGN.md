# Soda Rush — Design

## Game concept

Four counters run the width of a soda bar. Thirsty customers shuffle in from the
far end of each counter and walk steadily towards the tap, where you are
standing. You cannot leave the tap and you cannot walk down a counter — all you
can do is pick a counter, pull the tap, and let the mug slide.

A mug that reaches a customer is caught, drunk, and the customer wanders off the
far end satisfied. The empty mug comes sliding back down the counter towards you,
and you have to be standing at *that* counter to take it before it tips off the
end and smashes.

So the game is a two-directional juggling act: full mugs going out, empty mugs
coming back, and a counter you can only be on one of at a time. Serve everyone
in a round and the next round starts with more customers walking faster.

## Layout and coordinates

```
            TAP_X                                              END_X
              |                                                   |
 lane 0   [tap]============== counter =============================  <- customers enter
 lane 1   [tap]===================================================
 lane 2   [tap]===================================================
 lane 3   [tap]===================================================
```

* The canvas is `CANVAS_W` x `CANVAS_H` (760 x 480) and never scrolls.
* `LANES` (4) counters sit at `laneY(i) = LANE_TOP + i * LANE_GAP`.
* Everything on a counter is positioned by a single `x` in canvas pixels, between
  `TAP_X` (the tap, where the bartender stands) and `END_X` (the open end).
* `laneAt(y)` maps a canvas y back to the nearest counter, which is how mouse
  clicks are resolved.

All speeds are **per second** and every rule is evaluated inside `step(dt)`, so
the Playwright suite can advance the simulation frame by frame with no dependence
on `requestAnimationFrame` wall-clock timing. `autoStep` switches the render-loop
call to `step()` off so the tests own time completely.

## Entities

| Entity | Fields | Notes |
|---|---|---|
| `bartender` | `lane`, `pourCooldown`, `pourAnim` | always at `TAP_X`; only `lane` changes |
| customer | `lane`, `x`, `state`, `timer`, `tint` | `state` is `walking`, `drinking` or `leaving` |
| mug | `lane`, `x`, `full`, `resting`, `timer` | `full` mugs travel right, empties travel left |
| shard | `x`, `y`, `vx`, `vy`, `life`, `tint` | glass particles, cosmetic only |

### Customer life cycle

```
spawn at END_X ── walking ──(caught a mug)── drinking ──(DRINK_TIME)── leaving ──> off END_X: satisfied
                     │                           │
                     │                           └── releases the empty mug at its own x
                     └──(reached TAP_X)── grabbed: a life is lost
```

A `drinking` customer stands still. A `leaving` customer runs right at
`EXIT_SPEED` and ignores mugs. Both of those are *resolved* for the purposes of
finishing the round: `resolved` counts every customer that has left the counter,
satisfied or not.

### Mug life cycle

```
pour() at TAP_X ── full, moving right ──(overlaps the leftmost walking customer)── served
                                       └──(passes END_X)── smashes: a life is lost

released by a drinker ── empty, moving left ──(reaches TAP_X)── resting, CATCH_GRACE on the clock
                                                                 ├── bartender in this lane: caught
                                                                 └── grace runs out: smashes, a life is lost
```

`CATCH_GRACE` is the heart of how the game stays fair. An empty mug does not
demand a frame-perfect lane change; it parks at the tap for nearly a second and
smashes only if you never come. Because lane changes are instant, that turns an
unwinnable "two empties arrive at once in different lanes" situation into a
solvable one, and it is what lets the end-to-end test drive the game with a
simple greedy strategy.

## Rules in `step(dt)`

`step()` runs a fixed order every frame, and it is a no-op unless `state` is
`playing`:

1. Tick the pour cooldown, the pour animation and the round banner.
2. Advance `levelTime` and spawn every queued customer whose `time` has passed.
3. Move customers (walk / drink / leave), collecting removals and at most one
   life-loss reason.
4. Collect every resting empty in the bartender's lane — *before* the grace
   windows are ticked, so a mug whose last moment and the bartender's arrival
   fall on the same frame is caught rather than lost.
5. Move mugs: full mugs rightwards with a collision test against the leftmost
   `walking` customer in the lane; empties leftwards, parking at the tap, and
   resting ones counting down their grace.
6. Apply removals, then apply one life loss if the frame produced any.
7. If the round is over (`spawnIndex` has consumed the queue and no customers or
   mugs are left) advance the level.
8. Age the glass shards and refresh the HUD.

Collecting removals *before* applying them keeps the arrays stable while they are
being iterated, and means a single frame can never cost two lives even if, say,
a mug smashes while a customer reaches the tap.

### Losing a life

`loseLife(reason)` drops `lives`, resets the combo, throws a burst of shards,
names the mistake on screen for `NOTICE_TIME` seconds (the three reasons —
`grabbed`, `spilled`, `dropped` — map to a banner, because a player who cannot
tell *which* of the three just happened cannot correct it), and then *resets the
counters*: every mug in play is removed and the surviving
walking customers are pushed `RESET_PUSH` pixels back towards the open end. That
keeps the pressure on (the customers are still coming) without the unfair
cascade where a customer standing at the tap costs the rest of your lives in the
following frames. When `lives` hits zero the state becomes `over` and the best
score is written to `localStorage` under `sodarush-best`.

## Rounds

There is no hand-authored level data. `levelConfig(n)` derives a round from its
number and `buildQueue(n)` turns that into a spawn schedule:

| Quantity | Formula | Level 1 | Cap |
|---|---|---|---|
| customers | `6 + 2 * (n - 1)` | 6 | 20 |
| spawn gap (s) | `2.4 - 0.15 * (n - 1)` | 2.4 | min 0.8 |
| walk speed (px/s) | `30 + 7 * (n - 1)` | 30 | 95 |

`buildQueue(n)` is seeded from the level number through a small LCG, so a round
is reproducible: reloading the page and reaching level 3 always deals the same
schedule. Each entry is `{ lane, time }`; the jitter on the gap is
`0.8 + 0.4 * rng()`, and a lane is nudged off if it would be the *third*
arrival in a row on the same counter. Two in a row is a nice squeeze, three is
a pile-up you cannot answer with one tap.

## Scoring

| Event | Points |
|---|---|
| Mug caught by a customer | 50 |
| Customer leaves satisfied | 100 |
| Empty mug collected | 25 x combo |
| Round cleared | 300 x round number |

The combo rises by one with every empty collected, caps at `COMBO_MAX` (5), and
drops to zero the moment a life is lost — so the empties, not the pouring, are
where the score is really made.

## Controls

| Input | Action |
|---|---|
| `Up` / `Down`, or `W` / `S` | move to the counter above / below |
| `1`–`4` | jump straight to a counter |
| `Space` / `Enter` | pour a mug (and start or restart from the title screen) |
| click a counter | move there and pour in one gesture |
| `P` | pause |

## Rendering

`draw()` is pure presentation and never mutates game state, which is why the
tests can advance `step()` without drawing at all. The bar is drawn back to
front: room gradient and hanging lamps, then the four counters as wood slabs
with a lit top edge, then the brass tap tower and the bartender at `TAP_X`, then
customers, mugs, shards, and finally the combo pill and the round banner.

## Assumptions

These are the places where the brief left room, and the simpler reading was
taken. Each is a deliberate simplification of the arcade original this riffs on:

1. **The bartender never leaves the tap.** In the arcade you run up and down the
   bar to collect empties and tips. Here the bartender holds a counter and the
   empties come to the tap, which removes a whole axis of movement and keeps the
   state space small enough to test exhaustively.
2. **Lane changes are instant.** No walk time between counters. With the
   `CATCH_GRACE` window this is what makes the game fair rather than trivial:
   you can always *get* there, the question is whether you noticed in time.
3. **One mug satisfies one customer.** The original pushes a customer back a
   little per mug and needs several to clear them. One mug per customer keeps the
   round arithmetic legible and the feedback immediate.
4. **No tips.** A tip pickup needs a bartender who can roam the bar, which
   assumption 1 rules out. The combo multiplier on collected empties does the
   same job of rewarding a clean round.
5. **Rounds are formula-driven, not authored.** Levels are generated from their
   number, so the game never runs out and there is no layout data to keep valid.
   The seeded queue keeps that reproducible.
6. **A round is cleared, not survived.** Clearing needs every queued customer
   resolved *and* the counters empty, so a round cannot tick over while a mug is
   still sliding.
7. **One life per frame, maximum.** Two disasters in the same `step()` cost one
   life; the reset that follows would have cleared the second one anyway.
8. **Empty mugs pass walking customers.** Customers only interact with full
   mugs. An empty sliding under a customer's nose is ignored.
9. **Branch naming.** The brief asks for a branch named after the game, but this
   session is also required to push to its designated branch
   (`claude/compassionate-ramanujan-el3oqy`). The work is developed on a local
   `soda-rush` branch and published on the designated branch, which is the
   instruction that governs pushes.
