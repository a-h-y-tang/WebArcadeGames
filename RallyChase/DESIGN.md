# Rally Chase — Design

## Game concept

A top-down, scrolling maze-driving game. You drive a rally car around a walled
circuit that is larger than the screen, hunting the ten flags scattered through
it while a pack of pursuit cars hunts *you*. The screen scrolls to follow your
car, and a radar panel on the right shows the whole circuit at once — the flags
you have not taken, the pursuers closing in, and where you are between them.

Two things separate it from a plain chase: **fuel** and **smoke**. Fuel drains
the whole time you drive, and an empty tank does not end the run — it just makes
you slow, which is worse. Your only weapon is a smoke screen: tap the smoke key
and a cloud drops behind you, and any pursuer that drives through it spins out
for a few seconds. Smoke costs fuel, so every escape is paid for out of the same
tank that keeps you fast.

Nothing else in the repo uses a scrolling maze with a radar minimap. The
existing driving games (Road Racer, Turbo Racer, Road Rush) are lane-scrollers,
and the existing maze games (Pac-Man, Maze) are single-screen and unscrolled, so
the camera, the radar and the fuel/smoke economy are all new ground here.

## World geometry

Everything is derived from a square grid, so the layout is easy to reason about
and to assert on in tests.

| Constant | Value | Meaning |
|---|---|---|
| `CELL` | 40 px | one grid cell |
| `COLS` × `ROWS` | 21 × 15 | grid size |
| `WORLD_W` × `WORLD_H` | 840 × 600 px | the whole circuit |
| `VIEW_W` × `VIEW_H` | 560 × 480 px | the scrolling window onto the circuit |
| `RADAR_W` | 160 px | radar panel to the right of the window |
| `CANVAS_W` × `CANVAS_H` | 720 × 480 px | the canvas (`VIEW_W + RADAR_W` wide) |

The world is wider *and* taller than the view, so the camera scrolls on both
axes. It centres on the car and is then clamped to the world, so the view never
shows anything outside the circuit.

### The circuit

The maze is generated from a rule rather than hand-drawn, which keeps it
compact and guarantees it is fully connected:

1. The outer ring of cells is wall.
2. An interior cell is wall when **both** its column and its row are off the
   3-grid (`col % 3 !== 0 && row % 3 !== 0`). That leaves open corridors along
   every third column and every third row — a lattice of 2×2 blocks, which is
   the classic rally-maze look.
3. A seeded random pass then opens about one in eight of the remaining wall
   cells, carving alcoves and short dead ends for variety.

Because step 3 only ever *removes* wall, connectivity from step 2 survives: every
open cell is reachable from every other one. The seed is derived from the level
number, so each level has its own circuit and every run of a given level is
identical — which is what makes the tests deterministic.

## Mechanics

### Driving

Cars move along corridors like maze-game pieces rather than like free bodies:
they travel between cell centres, and a turn only takes effect at a centre. A
steering input is remembered as a *want* direction and applied at the next
centre where that direction is open, so you can set up a turn early instead of
having to hit the corner frame-perfectly. Reversing is the exception — it is
allowed anywhere in a corridor, and simply swaps the car's target back to the
cell it came from. Driving into a wall stops the car at the centre in front of
it; it keeps its heading, so releasing into an open direction sets off again.

### Flags

Ten flags are scattered over open cells, never within two cells of the start.
Driving over one collects it:

| Flag | Effect |
|---|---|
| plain (8 of them) | 100 points × the current multiplier |
| special (1) | scores, then **doubles** the multiplier (capped at ×4) |
| fuel (1) | scores, and puts 40 units back in the tank |

The multiplier starts at ×1 each level, so taking the special flag early is
worth far more than taking it last. Collecting all ten clears the level and pays
a fuel bonus of 10 points per unit left in the tank.

### Fuel

The tank holds 100 units and drains at 2.2 units per second — about 45 seconds
of driving. Running dry is not fatal: the car drops to 55% speed, which is
slower than the pursuit cars, so an empty tank usually ends the life shortly
afterwards. Fuel only drains while the game is actually running, so pausing is
not a way to lose and idling on the start screen costs nothing.

### Smoke

A smoke puff costs 6 fuel and lasts 4 seconds. Any active pursuer whose centre
comes within 24 px of a puff spins out for 3 seconds: it stops dead, cannot hurt
you, and is worth 200 points. Spinning several pursuers with one puff is
allowed and is the main way to score outside the flags. With less than 6 fuel in
the tank the key does nothing.

### Pursuers

Each level starts `min(6, level + 2)` pursuit cars at fixed corners of the
circuit — three on level 1, rising to six by level 4. They use the same corridor
movement as the player and re-choose their direction at every cell centre:
of the open directions (excluding a reverse, unless the cell is a dead end) they
take the one that most reduces the straight-line distance to the player, with a
fixed tie-break order so a given situation always plays out the same way.

For the first 1.5 seconds of a level — and of every respawn — the pursuers hold
still while the view shows `GET READY`. Without that hold they converge on the
start before the player has read the circuit, which turns a lost life into a
second lost life; with it, a crash costs you position rather than the run.

Pursuers get faster with the level — `84 + 6 × (level − 1)` px/s — but the speed
is capped at 92% of the player's full speed, so a car with fuel in the tank can
always outrun them. That cap is what makes running dry the real threat rather
than the pursuers' raw speed.

### Lives and levels

Touching an active pursuer (within 28 px) costs a life. The circuit is not
reset: flags you have already collected stay collected, so a life lost late in a
level is not a whole level lost. The car and the pursuers return to their
starting cells, the tank is refilled, and play resumes after a short pause. Out
of lives ends the run, and the best score is kept in `localStorage` under
`rallychase-best`.

## Controls

| Input | Action |
|---|---|
| `←` `→` `↑` `↓` / `W` `A` `S` `D` | steer |
| `Space` | drop a smoke puff (also starts the game when idle or after game over) |
| `Enter` | start / restart |
| `P` | pause / resume |

## Code layout

`RallyChase/` holds a plain static page — no build step, no modules, no
dependencies:

- `index.html` — HUD, canvas, overlay, help text.
- `style.css` — dark rally-night palette shared by the HUD and the overlay.
- `game.js` — the whole game as top-level `var`/`function` declarations, which
  puts them on `window` so the Playwright specs can call them directly.
- `tests/rallychase.spec.js` — the Playwright suite.

`game.js` is organised as: constants → maze generation → entity movement →
`step(dt)` → `draw()` → input wiring → animation loop. The animation loop only
ever calls `step(dt)` and `draw()`, and `step` is a pure function of the world
state plus `dt`, so the specs can drive the simulation frame by frame with
`step(1/60)` instead of waiting on wall-clock time. Test-only seams are kept to
a small, named set: `placeCar`, `spawnEnemy`, `collectAllFlagsForTest` and the
`enemySpeed`/`enemyCount`/`carSpeed` helpers.

## Assumptions

These are the judgement calls made while building the game, recorded here as
required by the task brief:

- **Branch naming.** The brief asks for a branch named after the game
  (`rally-chase`), while the session's standing instructions designate
  `claude/loving-euler-mnkh9y` as the branch to push to. The work is done on a
  local `rally-chase` branch and pushed to the designated remote branch, which
  satisfies both without pushing anywhere unauthorised.
- **Original game, familiar formula.** The brief asks for a novel game, not a
  novel *genre*. This is an original implementation of the flag-collecting
  maze-chase formula — no assets, code or level data are taken from any existing
  game.
- **Flags persist through a death.** Losing a life could reasonably reset the
  circuit. Resetting it makes a long level punishing to the point of being
  unfun, so collected flags stay collected; only positions and fuel reset.
- **The pursuers hold at the start.** A 1.5-second hold after every start and
  respawn was added after play-testing showed a bot being converged on within
  four seconds of spawning. The alternative — spawning the pursuers further
  away — does not help on a circuit this size.
- **An empty tank is not death.** The simpler reading of "fuel" would be that
  running out ends the life. Slowing the car instead keeps the player in the
  game and makes fuel a pressure rather than a timer.
- **Smoke lingers, and is not consumed.** A puff keeps working for its full 4
  seconds and can spin more than one pursuer, rather than being spent on the
  first contact.
- **Fixed pursuer count per level.** Pursuers all start with the level instead
  of trickling in on a timer. Nothing has to be seeded off wall-clock time, so
  the whole simulation stays deterministic.
- **Deterministic circuits.** Maze and flag layout come from a seeded PRNG keyed
  on the level number, not `Math.random()`, so a level always looks the same.
  This is what lets the specs assert on layout at all.
- **Radar shows everything.** No fog of war — the radar shows all uncollected
  flags and all pursuers. Hiding them would make the panel decorative, and the
  panel is the main reason the scrolling maze is playable.
