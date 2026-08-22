# Flag Rally — Design

## Game concept

A top-down rally game played inside a scrolling pillar maze. You drive a rally
car through a course that is much larger than the window, hunting the ten
checkpoint flags scattered across it. Four rival cars hunt *you* — they steer
towards you continuously and a head-on touch wrecks your car. Your only weapon
is the smoke screen: a puff of exhaust dropped behind you that spins out any
rival that drives into it. Boulders litter the course and wreck you just as
surely as a rival does, and the whole run is on a fuel budget: when the tank
runs dry the engine keeps going but the car crawls and the smoke screen dies.

Nothing else in this repo plays like it. The repo's driving games (Road Racer,
Turbo Racer, Road Rush) are lane racers on a forward-scrolling strip, and its
maze-chase game (Pac-Man) is a fixed single screen with no camera, no fuel and
no way to fight back. Flag Rally is the combination — a free-roaming scrolling
maze, a pursuit you can disrupt, and a resource you spend to disrupt it — and
that combination is new here.

## World geometry

Everything derives from a tile grid so the layout is easy to reason about and
to assert on in tests.

| Constant | Value | Meaning |
|---|---|---|
| `TILE` | 32 px | one grid cell |
| `COLS` × `ROWS` | 27 × 21 | course size in cells |
| `WORLD_W` × `WORLD_H` | 864 × 672 px | course size in pixels |
| `VIEW_W` × `VIEW_H` | 480 × 480 px | the scrolling window onto the course |
| `PANEL_W` | 180 px | radar / gauge panel to the right of the window |
| `CANVAS_W` × `CANVAS_H` | 660 × 480 px | the whole canvas |

The course is wider *and* taller than the window, so the camera scrolls on both
axes. It follows the car and is clamped to the course bounds, so the view never
shows anything outside the walls.

### The maze

The course is a **pillar maze**: the outer ring of cells is solid wall, and
inside it a wall may only stand on a cell whose row *and* column are both odd.
Roughly two thirds of those candidate cells become pillars (chosen by the level's
seeded RNG); the rest stay open.

This shape was picked deliberately: every cell with an even row or an even
column is guaranteed open, and those cells form a connected lattice of corridors
that spans the whole interior. So **the course is always fully connected** — no
generation retries, no unreachable flags, no rival stuck in a pocket, and no
dead ends for the chase AI to have to reason about. It also gives the wide,
open, criss-crossing corridors that a driving game wants, instead of the
one-car-wide passages a perfect maze would produce.

Level layout comes from a seeded `mulberry32` RNG (`setSeed(n)`), so the same
seed always produces the same pillars, flags and boulders — which is what lets
the tests assert on layout at all.

## Mechanics

### Driving

The car is lane-locked: it always sits on the centre line of the corridor it is
travelling along, which keeps a 32 px car in a 32 px corridor honest. Steering
is a *request*, not an immediate turn — pressing a direction sets `car.want`,
and the turn is taken at the first moment the car is within `TURN_SNAP` (7 px)
of a cell centre and the cell in that direction is open. On the turn the car
snaps to the new lane's centre line. A reversal (180°) is always legal and
happens immediately.

Driving into a wall does not stop the game — the car simply cannot advance past
the centre of its current cell, so it sits against the wall until you steer
away.

### Flags

Ten flags are scattered on open cells at least 6 cells (Manhattan) from the
start, never on a boulder cell. Driving over one collects it for
`FLAG_POINTS` (100).

One flag is the **special flag**, drawn larger and in gold. Collecting it
doubles the value of every flag collected afterwards *on that level* (200 each).
It is worth the same 100 itself. This is the simple reading of Rally-X's
"special flag" — a straight ×2 on the remainder of the level, rather than the
arcade's escalating multiplier.

Collecting all ten clears the level. The clear bonus is
`level × 200 + floor(fuel) × 5`, so a fast clean run is worth markedly more than
a slow one. The next level rebuilds the course from a new seed with one more
rival (capped at 6) and two more boulders (capped at 14), and refills the tank.

### Boulders

Boulders are static hazards on open cells: touching one wrecks you exactly like
a rival does. They are laid one at a time, and a candidate cell is skipped if
putting a boulder there would leave any flag unreachable from the start without
crossing a boulder. Without that check roughly 1.5% of generated courses (found
by sweeping 200 seed/level combinations) sealed a flag behind boulders, which
made the level unwinnable — the flag could only be driven to by wrecking first.

Boulders are hazards for the player only. Rivals ignore them, which keeps the
chase AI to one rule and means you cannot use a boulder as cover.

### Rivals

Rival cars move cell to cell. On arriving at a cell centre each one picks the
open neighbour that minimises Manhattan distance to the player, never reversing
unless that is the only legal option. Ties break on a per-rival preference
order, so four rivals chasing from the same cell fan out instead of stacking.
They speed up by `ENEMY_SPEED_STEP` each level, capped just under the player's
speed — you can always outrun them in a straight line, but not around corners.

Touching a rival within `CRASH_R` (20 px) wrecks you. A spun-out rival is inert:
it does not move and it does not wreck you, so a smoked rival is a corridor you
can drive through.

### Smoke screen

`Space` drops a puff of smoke one car-length behind you. It costs
`SMOKE_COST` (6) fuel, has a `SMOKE_COOLDOWN` (0.25 s) between puffs, and lives
`SMOKE_LIFE` (1.6 s). A rival whose centre comes within `SMOKE_R` (22 px) of a
live puff spins out for `SPIN_TIME` (3 s) and scores `SPIN_POINTS` (200). A puff
can only spin one rival — it is consumed by the hit — so a wall of smoke is
worth building when several rivals converge.

No smoke is produced with an empty tank.

### Fuel

The tank starts at `FUEL_MAX` (100) and drains `FUEL_DRAIN` (2 / s) while
running, plus 6 per puff. At zero the car is not wrecked — it drops to
`EMPTY_SPEED_FACTOR` (0.55) of its speed and cannot make smoke. Running dry is a
slow strangling rather than a sudden death, which keeps a nearly-finished level
playable, and it means the fuel-remaining clear bonus is the thing that actually
punishes dawdling.

### Wrecks, lives and game over

A wreck (rival or boulder) costs a life, clears all smoke, and puts the game in
the `crashed` state for `RESPAWN_TIME` (1.2 s); then the car and every rival
return to their start cells. Flags already collected stay collected — the level
is not restarted, only the cars. When the last life goes the game ends, the best
score is written to `localStorage` under `flagrally-best`, and the overlay shows
the final score.

### Scoring summary

| Event | Points |
|---|---|
| Flag | 100 (200 after the special flag) |
| Spinning out a rival | 200 |
| Clearing a level | `level × 200 + floor(fuel) × 5` |

## Controls

| Input | Action |
|---|---|
| `←` `→` `↑` `↓` or `A` `D` `W` `S` | steer |
| `Space` | drop smoke (or start / restart when not running) |
| `P` | pause / resume |
| Start button | start, restart, or resume from pause |

## Display

The canvas is split: the left 480 × 480 is the scrolling window onto the course,
the right 180 px is a fixed panel holding

- a **radar** — the whole course scaled down, showing every uncollected flag,
  every rival, and the player, so you can plan a route to a flag you cannot see;
- a **fuel gauge** that turns amber below a quarter tank and red when empty;
- the flags-remaining count.

Score, level, lives and best score live in the HTML HUD above the canvas, the
same arrangement the other games in this repo use.

## Code shape

`game.js` is a single classic (non-module) script, matching BurgerTime, Kaboom!,
Snake and the rest of the repo. Everything is a plain global, so the Playwright
specs can reach `car`, `enemies`, `flags`, `state` and the helpers directly.

All motion is per-second and applied through `step(dt)`. `requestAnimationFrame`
only supplies `dt` and calls `draw()`; it holds no game logic. That means the
tests advance the simulation by calling `step(1/60)` in a loop and never depend
on wall-clock timing — the same deterministic-frames approach the other games
here use.

Structure of `game.js`:

1. constants (grid, car, rivals, smoke, fuel, scoring)
2. seeded RNG and level generation (`setSeed`, `buildMaze`, `placeFlags`,
   `placeRocks`, `flagsReachable`)
3. grid helpers (`isOpen`, `colOf`, `rowOf`, `centerX`, `centerY`, `nearestOpen`)
4. state and level lifecycle (`startGame`, `buildLevel`, `resetCars`,
   `loseLife`, `nextLevel`, `endGame`)
5. per-frame update (`step`) — player, rivals, smoke, fuel, pickups, collisions
6. rendering (`draw`) — maze, boulders, flags, smoke, cars, radar, gauges
7. input wiring and the `requestAnimationFrame` loop

## Assumptions

The task said to create a branch named after the game, but the session's
standing instruction pins all work to the branch `claude/loving-euler-wl1904`
and forbids pushing anywhere else. The standing instruction wins: the work is on
`claude/loving-euler-wl1904`, not on `flag-rally`.

Other choices made where the brief was open, always taking the simpler reading:

- **Running out of fuel does not kill you.** It slows the car and disables smoke.
  A fuel-out death would end runs abruptly and made the fuel-bonus scoring
  pointless.
- **The special flag is a flat ×2** for the rest of the level, not an escalating
  or persistent multiplier.
- **Spun-out rivals are harmless and stationary**, and can be driven through.
- **A puff of smoke spins at most one rival**, then vanishes.
- **A wreck does not reset the level**, only the car positions. Collected flags
  stay collected.
- **Boulders are static, and only the player can hit them.** They never move,
  spawn or fall, and rivals drive straight over them.
- **The course is regenerated from a new seed each level** rather than shipping
  hand-authored levels, so difficulty comes from rival count, rival speed and
  boulder count.
- **No sound.** No other game in this repo ships audio, and no assets are
  fetched — the game is one HTML file, one stylesheet and one script, openable
  straight off the filesystem.
