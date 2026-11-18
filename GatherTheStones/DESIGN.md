# Gather the Stones — design

> "And he fenced it, and gathered out the stones thereof, and planted it with the
> choicest vine." — Isaiah 5:2

## Concept

A vineyard cannot be planted until the field has been cleared. The player works a
stony hillside: a woven **basket** slides along the bottom of the field, and a
round **threshing stone** is kept in the air with it. Every time the stone strikes
a field stone, that stone is knocked loose and gathered in; clear a whole field and
the next terrace of the hillside is opened. Five fields later the vineyard is
planted.

Mechanically this is a paddle-and-ball brick game — the genre is missing from the
collection (the nearest neighbours are *Pang*, a projectile balloon popper, and
*Split Ball*, a wall-growing arena game). The theme is a thin, accurate wrapper
over the rules, which is all CLAUDE.md asks for: names, art and story text change,
the rules do not.

## Mechanics

### The field

* Canvas is 520x600. A dry-stone wall 14px wide runs along the left, right and top
  edges; the bottom edge is open and losing the stone there costs a worker.
* Field stones sit on a 12-column grid, each cell 41x22px, starting 128px down, so
  the stone is not crossing bare soil for most of a rally.
  Levels are written as arrays of 12-character rows:

  | char | stone | hits | points | colour |
  |---|---|---|---|---|
  | `.` | empty | — | — | — |
  | `l` | loose stone | 1 | 10 | pale sand |
  | `p` | packed stone | 2 | 20 | warm brown |
  | `b` | boulder | 3 | 30 | slate grey |
  | `X` | bedrock | never breaks | 0 | dark basalt |

  A cracked stone darkens as it loses hits, so the player can see what is left.

* Five fields, each with a name drawn from the work of clearing ground: *Stony
  field* (38 hits), *Terraced slope* (54), *Thorn hedge* (50), *Old wall* (54),
  *Vineyard gate* (70). Bedrock appears from field 3 on, so later fields need
  angles rather than brute force. Playing the whole game out with a basket that
  simply tracks the stone takes about eight minutes.

### The stone and the basket

* The basket is 92px wide (132px while *Wide basket* is running) and sits at
  y = 548. It is moved by the mouse (the basket centres on the pointer) or by the
  arrow / A-D keys at 460 px/s, and is clamped inside the wall.
* The threshing stone has radius 7. Its speed starts at 320 px/s on field 1 and
  rises 18 px/s per field, plus 8 px/s for every eight stones gathered, capped at
  540 px/s.
* Before launch the stone rests on the basket and moves with it. **Space** (or a
  click) launches it upward at a slight angle.
* Bounces: the wall reflects the stone exactly; the basket reflects it by *where*
  it lands. The offset from the basket's centre, scaled to [-1, 1], is turned into
  an angle of up to 62° from vertical, and the speed is preserved. That gives the
  player aim without needing spin.
* Two rules stop the stone from going nowhere, both found by playing the game out
  under test rather than by reading the code:
  * the basket never returns the stone closer than 17° to vertical, or a cleared
    column would let it bounce up and down for ever; and
  * after five seconds without striking a stone the basket starts varying the
    bounce, by a spread that widens the longer the drought lasts, so the last lone
    stone of a field is always found. Without this, a player who tracks the stone
    perfectly locks it into a cycle that repeats to the pixel.
* Stone-vs-stone collisions resolve on the axis of least penetration, so corner
  hits behave sensibly. Each `step(dt)` is split into sub-steps small enough that
  the stone never travels more than its own radius in one sub-step, which keeps it
  from tunnelling through a row at high speed.
* A stone that falls past the bottom of the field is lost. With other stones still
  in play nothing happens; when the last one is lost a worker is lost with it, and
  at zero workers the game ends.

### Gifts (power-ups)

A knocked-out stone has a 22% chance (seeded RNG, so tests are repeatable) of
leaving a gift behind, which drifts down at 125 px/s and must be caught with the
basket. Catching one is worth 25 points.

| gift | effect | duration |
|---|---|---|
| Wide basket | basket 92 → 132px | 20s |
| Steady hand | stone speed x0.72 | 15s |
| Three stones | splits the stone in play into three | — |
| Sticky pitch | the basket holds the stone; Space releases it | 20s |
| Extra helper | +1 worker (max 5) | — |

Timed gifts show as a labelled bar under the HUD, and a gift of a kind already
running simply restarts its clock.

### Scoring and progress

* Stones score 10 / 20 / 30 by type; gifts 25; clearing a field is worth
  `100 x field number`.
* A field is complete when no breakable stone is left — bedrock is ignored.
* Best score is kept in `localStorage` under `gather-the-stones-best`.

### Controls

| input | action |
|---|---|
| mouse over the field | move the basket |
| ← → or A D | move the basket |
| Space / click | launch, release a held stone, start, dismiss an overlay |
| P | pause / resume |
| R | restart from field 1 |

## Code layout

`game.js` is one classic script, no modules or build step, in the same shape as
the other action games in this repo:

1. **Constants** — canvas and field geometry, stone table, level maps, gift table.
2. **State** — `state` ('ready' / 'playing' / 'paused' / 'levelComplete' /
   'gameOver' / 'won'), `score`, `lives`, `levelIndex`, `balls`, `paddle`,
   `bricks`, `powerups`, `effects`, `timers`.
3. **Pure-ish helpers** — `brickRect`, `brickAt`, `aliveBreakable`,
   `ballSpeed`, seeded `rand`.
4. **Simulation** — `step(dt)` advances basket, stones, gifts, gift timers and
   particles in fixed sub-steps and raises every rule above. It is exported as a
   global so Playwright can simulate frames deterministically instead of waiting
   on `requestAnimationFrame`. `giftChance` is a global too, so a test can pin the
   drop rate at 0 or 1.
5. **Input** — keyboard, mouse and button handlers; they only set intent
   (`keys.left`, `paddle.targetX`) so the simulation stays in one place.
6. **Render** — `draw()` paints the frame, the stones, the basket, the stone, the
   gifts, the particles and the overlay text.
7. **Frame loop** — `requestAnimationFrame` calls `step` with a clamped dt; `step`
   itself does nothing unless the game is in play. Tests set `autoAdvance = false`
   to freeze the loop and call `step` themselves.
8. **Scenery** — the wall stones and the pebbles in the soil are generated once
   from a fixed seed at load, so the ground does not shimmer between frames.

## Testing

`tests/gather-the-stones.spec.js` is a Playwright suite written before the game
and run against `index.html` over `file://` — no server needed. Its 74 tests cover
the initial state and HUD, basket movement and clamping, launching, wall and
basket reflection, stone damage and scoring, bedrock, losing stones and workers,
field completion and the win, every gift, pause, restart, the geometry of all five
levels, and that no page or console error is raised. Physics tests freeze the
animation loop (`autoAdvance = false`) and drive `step(dt)` directly.

Two of them are playability tests rather than unit tests, and they are the ones
that found the stalls described above: one plays field 1 out with a basket that
centres on the stone and expects the field to come clear, and one leaves a single
stone in an awkward corner and expects it to be found.

## Assumptions

Decisions taken without being able to ask, with the simpler reading chosen each
time:

* **Theme.** CLAUDE.md prefers a Christian theme where a game can carry one. A
  paddle game cannot carry a Bible *story*, so the theme is the honest work behind
  Isaiah 5:2 — clearing a stony field before planting a vineyard. No walls of a
  city, no altar: *Walls of Jericho* already exists and knocking down someone's
  wall is not what this game is about.
* **Branch.** The instructions ask for a branch named after the game; this session
  may only push `claude/compassionate-ramanujan-knt8k7`. The work is committed on
  the local `gather-the-stones` branch and pushed to the permitted remote branch.
* **One stone at a time.** No separate "balls" HUD: workers (lives) are the only
  counter, and the *Three stones* gift is temporary rather than a tracked resource.
* **Speed.** Rising with the field and with stones gathered, rather than with each
  basket hit, so a long rally cannot make the game unplayable.
* **No sound.** The rest of the collection is silent, so this game is too.
* **Mouse and keyboard only.** Touch works through the mouse events the browser
  synthesises; no separate pointer handling.
