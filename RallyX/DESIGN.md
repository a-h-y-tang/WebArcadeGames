# Rally-X — Design

## Concept

A scrolling maze chase. You drive a blue rally car around a walled course that
is larger than the screen, collecting every flag before your fuel runs out.
Red pursuit cars hunt you through the same maze. Your only weapon is the smoke
screen: a puff of exhaust dropped behind you that spins out any chaser that
drives into it. A radar panel on the right of the canvas shows the whole
course — flags, chasers and your own car — so you can plan a route through the
part of the maze you cannot see.

Nothing in the repo plays like it: Pac-Man's maze is a single fixed screen with
no scrolling, no fuel and no droppable defence, and the repo's other chase
games (Berzerk, Pengo) are room-at-a-time shooters. Here the pressure comes
from route planning against a draining fuel gauge while reading a minimap.

## Mechanics

### The course

* A course is a grid of cells: `#` wall, `.` road, `F` flag, `S` special flag,
  `P` player spawn, `E` chaser spawn.
* Built-in courses are 24 x 18 cells at 32 px, so the world is 768 x 576 —
  larger than the 440 x 360 maze viewport, which scrolls to follow the car and
  clamps at the world edges.
* Three courses ship with the game. Levels cycle through them
  (`level 4` replays course 1) with more and faster chasers each time.

### Driving

Cars move cell-by-cell along the roads with floating-point positions, in the
style of a Pac-Man/Rally-X grid:

* A car may only change to a perpendicular direction when it is exactly on a
  cell centre and the target cell is road. A reversal (180°) is allowed at any
  time, mid-cell, which is what makes evading a chaser in a corridor possible.
* Movement is resolved in `moveEntity()` by walking the remaining distance of
  the frame centre-to-centre, so a car can never tunnel through a wall however
  large `dt` is.
* The player drives at 4.0 cells/sec. Chasers start at 2.8 cells/sec and gain
  0.2 per level, capped at 3.8 — always slower than the player, so the maze,
  not raw speed, is the threat.

### Chasers

At each cell centre a chaser scores every open direction except a reversal
(allowed only in a dead end) by the resulting straight-line distance to the
player, and takes the best one. One time in five it takes a random legal
direction instead, so chasers spread out rather than forming a single train.
The randomness comes from a seeded LCG re-seeded at `startGame()`, so a run is
reproducible and the tests are deterministic.

Touching an active chaser (within 0.6 cells) costs a life. A chaser that is
spun out by smoke is harmless and can be driven straight through.

### Smoke screen

`Space` drops a puff of smoke at the car's current cell. It costs 4 fuel,
has a 0.2 s cooldown, and lingers for 2.5 s. Any chaser that comes within
0.8 cells of a live puff spins out for 3 s: it stops dead, cannot move and
cannot hurt you. Smoke is checked before collisions each frame, so a chaser
driving into a fresh puff spins out rather than hitting you in the same frame.

### Fuel

Fuel starts at 100 and drains 1.8 per second, giving roughly 55 seconds per
round, minus whatever the smoke screen burns. Running dry costs a life, the
same as being caught.

### Flags, scoring, lives

| Event | Points |
|---|---|
| Flag | 100 (200 after the special flag) |
| Special flag `S` | scores as a normal flag, then doubles every later flag in the round |
| Round cleared | remaining fuel x 10 |

Clearing every flag loads the next course, refills the tank and resets the
cars. Losing a life (caught or out of fuel) resets the cars and refills the
tank but *keeps* the flags already collected, so a bad round is a setback and
not a restart. Three lives; the best score is kept in `localStorage` under
`rally-x-best`.

## Controls

| Key | Action |
|---|---|
| Arrow keys / WASD | Steer |
| Space | Drop smoke (starts or restarts the game when not playing) |
| P / Esc | Pause |

## Code layout

`game.js` is a single classic (non-module) script — no build step, no modules —
so every piece of state is reachable from the Playwright tests as a plain
global, matching Lode Runner, Kaboom and Tetris in this repo.

* **State**: `state` (`idle` / `running` / `paused` / `gameover`), `score`,
  `best`, `lives`, `level`, `fuel`, `flagValue`, `player`, `enemies`, `flags`,
  `smokes`, `grid`.
* **`step(dt)`** advances the whole simulation — driving, chasers, smoke,
  fuel, pickups, collisions — and returns immediately unless `state` is
  `running`. The real-time loop calls it from `requestAnimationFrame` with a
  clamped `dt`; tests call it directly.
* **`setAutoStep(false)`** detaches `step()` from the animation frame so tests
  drive the simulation frame by frame with no wall-clock dependence. Drawing
  and the HUD keep updating either way.
* **`loadLevelLines(lines)`** loads any rectangular course, of any size, from
  an array of strings. The tests use it to put cars in exact situations in tiny
  hand-built mazes.
* **`setFuel(v)` / `setLives(n)`** are test/debug hooks for reaching low-fuel
  and last-life situations without waiting a minute.
* **Rendering** splits the canvas: the left 440 px is the scrolling maze
  viewport, the right 160 px is a fixed panel with the radar (the whole course
  scaled down, with flags, chasers and the car) and the fuel gauge.
* **Cosmetics stay out of the simulation.** The "COURSE CLEAR" / "CAR LOST"
  banner and the pulsing low-fuel border are timed off the animation frame,
  never off `step(dt)`, so the simulation the tests drive stays pure and the
  game never pauses itself in a way a test would have to wait out.

## Assumptions

Made autonomously while building this, each resolved towards the simpler
reading:

* **Branch name.** The task asked for a branch named after the game
  (`rally-x`), but this session's standing instructions pin all work to
  `claude/compassionate-ramanujan-t6zil4`. The explicit branch instruction
  wins; no `rally-x` branch is created.
* **Out of fuel.** The arcade original lets a dry car limp on at reduced
  speed. Here running dry simply costs a life — one rule instead of two, and
  it keeps the fuel gauge meaningful.
* **Special flag.** The original has several bonus flag types. This version
  has exactly one: `S`, which doubles the value of every flag collected after
  it, for the rest of the round.
* **Scrolling.** The viewport scrolls in whole pixels and clamps at the world
  edge; courses smaller than the viewport (used by the tests) are centred
  rather than scrolled.
* **Lives and flags.** Losing a life keeps the flags already collected. The
  alternative — restarting the round — punishes a single mistake far too hard
  for a 55-second round.
* **Chaser count.** `min(spawn markers in the course, 1 + level)`, so course 1
  opens with two chasers and later levels fill every marker.
* **Sound.** None. No other game in this repo ships audio.
