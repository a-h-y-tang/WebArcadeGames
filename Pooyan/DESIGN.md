# Pooyan — Design

How the code works, why it is shaped this way, and which calls were judgement
calls rather than requirements.

## Concept

A mother pig defends her house from a pack of wolves that float across the sky
on balloons. She rides a basket up and down a rope on the right-hand side of
the screen and fires arrows to the left. Pop a balloon and the wolf drops out
of the sky. Let one drift all the way across and it reaches the house — that
costs a life. Wolves fight back by hurling rocks, and a joint of meat drifts
past once per wave: shoot it and it falls, sweeping every wolf beneath it.

Each wave has a fixed quota of wolves. Resolve the whole quota (popped,
swept, or lost through the right-hand wall) and the wave is cleared; the next
one sends more wolves, faster.

## Files

| File | Role |
|---|---|
| `index.html` | Markup: HUD, canvas, overlay, key legend |
| `style.css` | Presentation only — no layout is read back by the game |
| `game.js` | All state, simulation and rendering |
| `tests/pooyan.spec.js` | Playwright suite driving the simulation directly |

`game.js` is a classic (non-module) script, matching BurgerTime, Kaboom! and
Snake in this repo: every piece of state is a plain global, so the Playwright
tests can read and drive it without instrumentation hooks.

## Coordinate system and layout

The canvas is 640 x 480. All entity positions are **centres**, so collision
maths is symmetric and reads the same for every entity type.

```
 x=0                                                        x=640
  ┌────────────────────────────────────────────────┬──────┐  y=0
  │  wolves enter here, drift right  →             │ rope │
  │      (o)                (o)                    │  ▓   │  ← basket
  │      /W\   ← balloon+wolf         ●  ← rock    │  ▓   │
  │                      ══  ← meat                │      │
  └────────────────────────────────────────────────┴──────┘  y=480
                                            ESCAPE_X ↑
```

* The basket sits at a fixed `BASKET_X` and moves only on the y axis, clamped
  to `[BASKET_MIN_Y, BASKET_MAX_Y]`.
* A wolf "escapes" the moment its right edge crosses `ESCAPE_X`, which is the
  left face of the basket column — reaching the house and reaching the pig are
  therefore the same event, so there is only one failure rule to learn.

## Simulation

Everything is expressed per second and advanced by a single `step(dt)`:

1. **Basket** — `basket.y += basket.dir * BASKET_SPEED * dt`, then clamped.
2. **Arrows** — travel left at `ARROW_SPEED`; at most `ARROW_MAX` are in
   flight at once, which is what stops the game being a hold-space affair.
3. **Wolves** — travel right at the wave's speed in a straight line, and count
   down a throw timer that spawns a rock.
4. **Rocks** — travel right; a rock overlapping the basket costs a life.
5. **Meat** — drifts right until shot, then falls, sweeping a wider box than
   its own sprite (`MEAT_SWEEP_W`) so a well-timed shot clears a column.
6. **Arrow collisions**, resolved per arrow in the order wolf → rock → meat.
   An arrow is consumed by the first thing it hits.
7. **Spawning** — a wave-long quota released on a timer, with the meat
   released once the wave is half spawned.
8. **Wave end** — when the quota is resolved and the sky is empty.

Everything moves before anything collides, so a frame never resolves a hit
against a half-updated world. Steps 3 and 4 can end a life mid-frame; when
they do, `step` returns immediately and the remainder of the frame belongs to
the `dying` state rather than to play that is already over.

`step(dt)` is the only thing the animation loop does besides drawing, so the
tests advance the game by calling it in a loop with a fixed `dt`. Nothing in
the simulation reads wall-clock time.

### Randomness

`rand()` is a seeded LCG over the global `rngSeed`, so a test can call
`srand(1)` and get the same wave every run. Only spawn heights, throw delays
and spawn jitter use it.

### Test seams

Rather than mocking, the simulation exposes three switches the tests use to
isolate behaviour:

| Seam | Effect |
|---|---|
| `spawnEnabled` | Stops new wolves entering, for long deterministic runs |
| `rockEnabled` | Stops wolves throwing, so wolf tests are about wolves |
| `spawnWolf(y, x)` | Places one wolf exactly where a test wants it |

### Losing a life

`loseLife()` is deliberately the *only* path that decrements `lives`, and it
always clears the field: remaining wolves are counted as resolved, rocks and
arrows are dropped. That keeps one invariant true everywhere — a wave can
always be finished, because the wolves removed by a death still count towards
the quota. The game then sits in `dying` for `DEATH_PAUSE` seconds before the
basket re-centres and play resumes.

## States

```
idle ──start──► running ◄──► paused
                 │  │
                 │  └──death──► dying ──► running
                 │                └─(no lives)─► over ──start──► running
                 └──quota clear──► levelclear ──► running (next wave)
```

The overlay is visible in every state except `running`, and the same
`showOverlay(title, score, sub)` helper writes all of them.

## Scoring

| Event | Points |
|---|---|
| Balloon popped | 100 |
| Rock shot down | 25 |
| Wolf swept by falling meat | 200 |
| Wave cleared | 500 |

Best score persists in `localStorage` under `pooyan-best`.

## Controls

| Input | Action |
|---|---|
| `↑` / `W` | Ride the basket up |
| `↓` / `S` | Ride the basket down |
| `Space` | Fire an arrow (also starts the game from idle / game over) |
| `Enter` | Start / resume |
| `P` | Pause |
| Start button | Start / resume |

Movement keys are tracked in a held-key set and reduced to `basket.dir`, so
holding both directions cancels out instead of latching.

## Rendering

`draw()` paints, back to front: sky gradient, hills, the house and rope on the
right, meat, wolves (balloon, string, body), rocks, arrows, the basket with
the pig, then the wave banner. Every sprite is drawn from canvas primitives —
no image assets, so the game runs from `file://` with no server.

## Assumptions

These were ambiguous; the simpler reading was taken in each case and is
recorded here rather than in a comment nobody reads.

1. **Wolves drift horizontally, not vertically.** The arcade original has
   wolves descending a column while the pig rides alongside. Horizontal drift
   towards the pig keeps the "match the height, then shoot" skill intact,
   makes the failure condition (reaching the house) visually obvious, and
   keeps positions on a single axis of motion — much easier to assert on.
2. **A wolf getting through costs a life outright**, rather than the original's
   ladder-climbing escalation. One rule, no hidden counter.
3. **Wolves fly in straight lines** with no bobbing. Sine-wave drift would
   make aiming a matter of luck at this arrow speed, and would make every
   positional assertion in the suite phase-dependent.
4. **One joint of meat per wave**, released at the halfway mark. The original
   is less predictable; a fixed release makes it a tactic instead of a
   lottery.
5. **Unshot meat simply leaves** the screen with no penalty and no bonus.
6. **Waves are quota-based, not timed.** A slow, careful player is never
   punished by a clock.
7. **The quota grows by two per wave and caps at 20**, and wolf speed caps at
   `WOLF_SPEED_CAP`, so late waves stay hard but finite.
8. **Death clears the sky.** The alternative — respawning into whatever was
   already on screen — makes a bad wave unrecoverable.
9. **Arrows are unlimited**, with the three-in-flight cap as the only
   restraint; an ammo counter would add a second resource to track for no
   extra depth.
