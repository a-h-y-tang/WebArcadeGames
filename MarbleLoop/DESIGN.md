# Marble Loop — Design

## Concept

**Marble Loop** is a marble-shooter in the tradition of *Puzz Loop* / *Zuma*. A
conveyor of coloured marbles crawls along a spiral track toward a pit at the
centre of the board. The player sits in the middle of the spiral behind a
rotating launcher and fires marbles into the chain. Land three or more of the
same colour together and they burst; clear the whole track before the leading
marble tips into the pit.

Because a burst leaves a hole, the marbles behind it rush forward to close the
gap — and if the two ends that meet share a colour, they burst too. Setting up
those chain reactions is where the points are.

## Board and track

- The board is a **640 × 480** canvas.
- The track is an **inward spiral** of 2.15 turns, sampled into a dense polyline
  at load time. Cumulative segment lengths turn the polyline into an
  arc-length-parameterised curve, so any position on the track is a single
  number — the distance `d` travelled from the mouth (`0`) to the pit
  (`pathLength`, ≈ 2400 px, room for ~90 marbles).
- `pointAt(d)` maps a distance to an `{x, y}` point (clamped at both ends) and
  `tangentAt(d)` gives the unit direction of travel. Everything else — chain
  motion, collision, rendering — is expressed in terms of those two functions,
  so the track shape can change without touching the game rules.
- The **launcher** sits at the centre of the spiral (320, 240), clear of every
  point of the track by more than two marble diameters, and can rotate through a
  full 360°.

## Mechanics

### The chain

Marbles are stored front-to-back in `chain`, each `{ color, dist }`, where
`dist` is the distance along the track and `chain[0]` is the marble nearest the
pit. The invariant `chain[i-1].dist - chain[i].dist >= MARBLE_D` (26 px) holds at
all times — marbles never overlap.

Each frame:

1. **Feed.** While the level's queue (`spawnQueue`) is not empty and the tail
   marble has cleared the mouth, a new marble is appended at `dist = 0`. Feed
   colours never produce three of a kind in a row, so a fresh track can never
   burst on its own.
2. **Advance.** The leading marble moves at `chainSpeed(level)` px/s — or at the
   brisker `FEED_SPEED` while the queue is still emptying, which is what makes a
   level scroll in quickly and then settle into its crawl. Every marble behind
   the leader moves at the much faster `CATCH_UP` speed but is clamped to
   `chain[i-1].dist - MARBLE_D`, so packed marbles simply follow the leader while
   gaps close quickly. `dist` is monotonically non-decreasing: marbles never
   slide backwards on their own.
3. **Resolve.** Any run of three or more equal colours whose neighbours are
   *touching* (gap ≤ `MARBLE_D + 1`) bursts. Resolution repeats until no run
   remains, which is what produces cascades.

### Shooting

The launcher holds a **current** and a **next** marble; `S` swaps them. Firing
launches a projectile at `PROJ_SPEED` px/s along the aim angle, promotes the
next marble to current, and rolls a new next. A `FIRE_COOLDOWN` of 0.25 s stops
the button being held down. Shot colours are drawn only from colours still on
the track (falling back to the level palette when the track is empty), so a shot
is never dead weight.

A projectile that leaves the canvas is discarded. A projectile that comes within
one marble diameter of a chain marble is **inserted**:

- The offset from the marble's centre is projected onto the track tangent. A
  positive projection means the shot arrived on the pit side, so it goes in
  *ahead* of that marble; otherwise it goes in *behind* it.
- The new marble is placed adjacent to the marble it hit when there is room, and
  otherwise it displaces the chain **backwards** (never forwards), so a shot into
  a packed chain buys the player distance rather than costing it. The one
  exception is a shot that lands ahead of the leading marble, which has nothing
  to push against and so extends the chain toward the pit.

### Scoring

- A burst of `n` marbles scores `10 × n × combo`.
- `combo` starts at 1 and increases with every burst that happens within 1.4 s of
  the previous one, so a cascade is worth more than the same marbles cleared one
  at a time. It caps at ×5 and resets once the timer lapses.
- Clearing a level awards `100 × level`.
- The best score is persisted in `localStorage` under `marbleloop-best`.

### Levels

All difficulty is a pure function of `level`, which makes it trivial to test:

| Quantity                   | Formula                                  | Level 1 |
|----------------------------|------------------------------------------|---------|
| Marbles in the queue       | `34 + 6 × (level - 1)`                   | 34      |
| Chain speed (px/s)         | `20 + 4 × (level - 1)`                   | 20      |
| Colours in play            | `min(6, 3 + floor((level + 1) / 2))`     | 4       |

A level is **cleared** when the queue is empty and the track is empty; the game
is **over** the moment the leading marble's `dist` reaches `pathLength`. There is
one life — the run ends at the first breach.

## States

`idle` → `running` ⇄ `paused`, ending in `over` (chain reached the pit) or
`cleared` (track emptied). `Space` advances out of `idle`, `over` and `cleared`;
`P` toggles `paused`. The DOM overlay is shown in every state except `running`.

## Controls

| Input | Action |
|---|---|
| Mouse move | Aim the launcher at the pointer |
| Click | Fire |
| ← / → | Rotate the launcher |
| Space | Start / fire / continue |
| S | Swap the loaded and queued marble |
| P | Pause |

## Code layout

- `index.html` — canvas, HUD readouts and the overlay.
- `style.css` — dark arcade shell, HUD and overlay styling.
- `game.js` — a single classic (non-module) script so that state and helpers are
  reachable from Playwright as plain globals, matching the other games in this
  repo. All motion is per-second and applied through `step(dt)`, which the
  `requestAnimationFrame` loop calls with the real frame delta and the tests call
  with fixed 16 ms deltas for deterministic simulation.
- `tests/marbleloop.spec.js` — the Playwright suite.

Test seams deliberately exposed by `game.js`: `step`, `draw`, `startGame`,
`togglePause`, `shoot`, `shootAt`, `aimAt`, `swapMarble`, `reloadLauncher`,
`setChain`, `setSpawnQueue`, `setSeed`, `pointAt`, `tangentAt`, `chainSpeed`,
`paletteSize`, `levelMarbles`, plus the `chain`, `projectiles`, `launcher`,
`state`, `score`, `level`, `spawnQueue` and `shotsFired` globals.

## Assumptions

The task description left some points open. The simpler reading was taken in
each case, and the decisions are recorded here:

1. **Branch name.** The instructions asked for a branch named after the game
   (`marble-loop`), but this session is also required to develop and push on its
   designated branch `claude/loving-euler-9vcdw4`. The designated branch wins;
   no separate `marble-loop` branch is pushed.
2. **No power-ups.** Zuma's laser sight, colour bombs, reverse and slow-down
   pick-ups are omitted. The core insert/burst/cascade loop is the game.
3. **No backward recoil on a burst.** Some games in the genre shove the chain
   backwards after a burst. Here a burst only leaves a gap; the "reward" for
   good play is the cascade, which is simpler to reason about and to test.
4. **One life.** The leading marble reaching the pit ends the run outright
   rather than costing a life, matching the other single-life arcade games in
   this repo.
5. **Levels continue indefinitely.** There is no final level; difficulty keeps
   ramping and the palette caps at six colours.
6. **Randomness is seeded.** A small deterministic PRNG (`mulberry32`) backs all
   colour choices so tests can pin a seed. It is seeded from the clock on load
   for normal play.
7. **Insertion never pushes the chain forward** (except ahead of the leading
   marble, where there is nothing behind to absorb the shot). This is the
   player-friendly reading of an ambiguous rule.
8. **Fixed canvas size.** 640 × 480, no responsive scaling, like the rest of the
   repo's games.
