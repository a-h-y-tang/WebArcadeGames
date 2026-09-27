# Berzerk — Design

## Concept

Berzerk is a maze shoot-'em-up inspired by the 1980 Stern arcade cabinet. The
player is a lone humanoid dropped into an endless series of procedurally
generated maze rooms patrolled by hostile robots. Shoot the robots, dodge their
return fire, and walk out of any of the four doorways to reach the next room —
which is bigger trouble than the last one. Dawdle and **Evil Otto**, an
indestructible bouncing smiley that floats straight through walls, comes to
hurry you along.

There is no winning screen: the game is a score chase across as many rooms as
you can survive on three lives.

## Mechanics

- **The room** is a 20×15 grid of 32 px cells drawn on a 640×480 canvas. The
  border is solid except for ten *doorway* cells — three on each of the left and
  right walls, two on each of the top and bottom walls.
- **Maze generation.** Interior walls are three-cell segments anchored on a 3×3
  lattice (columns 3, 6, 9, 12, 15 and rows 3, 6, 9), each placed with a
  probability that grows slowly with the room number, oriented horizontally or
  vertically. Because anchors are spaced three cells apart, corridors always run
  between them. A candidate layout is accepted only if a flood fill from the
  room's centre still reaches *every* doorway; otherwise the next seed is tried.
  The centre cell is always kept clear so the player never spawns inside a wall.
- **Movement.** The player moves in eight directions at a constant speed;
  diagonals are normalised so they are no faster than straight lines. Collision
  is resolved one axis at a time against the wall grid, so sliding along a wall
  feels smooth. Walls block movement rather than electrocuting on contact (see
  *Assumptions*).
- **Shooting.** `Space` fires in the direction the player last moved. Exactly one
  player bullet may be in flight at a time, as in the arcade original — you have
  to make it count. Bullets are absorbed by walls and vanish at the room edges.
- **Robots.** Each room holds `min(8, 2 + room)` robots, spawned only on cells
  reachable from the player and at least five cells away. A robot chases along
  whichever axis it is furthest from the player on and falls back to the other
  axis when a wall blocks it, so it flows around obstacles without any
  pathfinding. Robots fire on an individual timer at one of eight snapped
  directions, with at most four robot bullets in the air at once.
- **Killing and dying.** A player bullet destroys a robot for 50 points. A robot
  caught in another robot's crossfire is destroyed too but scores nothing.
  Touching a robot, being hit by a robot bullet, or touching Otto costs a life
  and restocks the current room. Your own bullets can never hurt you.
- **Rooms and bonuses.** Walking through a doorway advances the room counter,
  regenerates the maze and re-enters the player from the opposite wall. Leaving a
  room with every robot destroyed awards a 100-point clearance bonus.
- **Evil Otto** appears after 20 seconds in a room — or just 5 seconds once every
  robot is dead, so an empty room is never a safe place to rest. He homes in on
  the player in a straight line, ignoring the maze completely, and cannot be
  shot. He arrives *slower* than the player (70 px/s) and accelerates by
  22 px/s² up to 175 px/s, so his appearance is a deadline rather than an instant
  death: you can outrun him at first, but not for long. The only answer is to
  leave.
- **Scoring.** 50 per robot plus 100 per cleared room. The best score is
  persisted in `localStorage` under `berzerk-best`.

### Difficulty scaling (pure functions of `room`)

| Quantity      | Formula                                             |
|---------------|-----------------------------------------------------|
| robot count   | `min(8, 2 + room)`                                  |
| robot speed   | `min(110, 52 + (room-1) * 4)` px/s, ±15% per robot  |
| wall density  | `min(0.6, 0.34 + room * 0.02)`                      |

## Controls

| Input                     | Action                          |
|---------------------------|---------------------------------|
| ← ↑ ↓ → / W A S D         | Move (eight directions)         |
| Space                     | Shoot in the facing direction   |
| Space / Enter (menu)      | Start or restart the game       |
| P                         | Pause / resume                  |

## Code structure

`game.js` is a single classic (non-module) script, matching the convention used
by Kaboom, Dino Run and Snake in this repo, so its state and functions are
reachable from Playwright as plain globals.

- **Maze**: `blankRoom()`, `generateWalls(room)`, `reachableFrom()`,
  `isWall(col,row)`, `exitCells()`.
- **Collision**: `boxHitsWall()` (entity boxes are smaller than one cell, so the
  four corners suffice) and `moveAxis()`, which moves one axis and snaps out of
  any wall it would have entered.
- **Rooms**: `enterRoom(n, side)` rebuilds the maze, robots, bullets and timers;
  `exitRoom(side)` pays the clearance bonus and advances.
- **Simulation**: `substep(h)` runs one fixed sub-step and returns `false` when
  the room changed underneath it (death or doorway), so the caller stops walking
  arrays that have just been rebuilt. `step(dt)` slices `dt` into 1/240 s
  sub-steps so 340 px/s bullets never tunnel through walls or robots.
- **Rendering** (`draw()`) is entirely separate from simulation, so the tests
  never depend on it.

## Determinism & testing

All randomness comes from a `mulberry32` PRNG seeded from the room number, so a
given room always produces the same maze and the same robot timings. Motion is
expressed per-second and advanced through `step(dt)`, letting the 58 Playwright
tests simulate frames exactly rather than waiting on `requestAnimationFrame`.

The suite covers the idle screen and HUD, maze generation (determinism, border
doorways, and that every doorway stays reachable in the first 25 rooms), eight-way
movement and wall collision, the one-bullet rule and wall absorption, robot
chasing / firing / friendly fire, room transitions and the clearance bonus, all
three ways Otto can end a life, and the lives / pause / game-over flow.

Tests drive the game through the same public surface the game uses:
`startGame()`, `setDir()`, `fire()`, `spawnRobot(x, y)`, `spawnOtto()`,
`enterRoom(n)`, `exitRoom(side)`, `killPlayer()` and `step(dt)`. A small
test-only helper installed via `page.addInitScript` clears interior walls so
movement and AI assertions run in a predictable open arena — it only writes to
the `walls` grid the game already exposes.

## Assumptions

These choices were made where the brief was open-ended; the simpler option was
taken each time and recorded here:

- **Walls block instead of electrocuting.** In the arcade original, touching a
  wall kills instantly. Here walls are simply solid for the player and the
  robots. This is far more forgiving on a keyboard, and it keeps collision
  handling to a single code path.
- **Robots do not kill themselves on walls.** The original's robots walk into
  walls and explode. Here they slide along walls instead, which keeps the threat
  level predictable and the tests deterministic.
- **Every exit leads "forward".** Any doorway advances the room counter by one
  rather than modelling a 2-D map of rooms, so there is no backtracking. The
  player re-enters the new room from the opposite wall.
- **Room number, not a global timer, drives difficulty.** Robot count, speed and
  wall density derive purely from `room`, keeping the simulation reproducible.
- **Otto arrives sooner in a cleared room** (5 s instead of 20 s) so that
  camping in an empty room is never a viable strategy.
- **Dying restocks the current room** with a fresh set of robots at the same room
  number, rather than sending the player back to room 1.
- **No speech or sound.** The original is famous for its "Intruder alert!" voice;
  this version shows a flashing on-canvas warning instead, keeping the game
  silent like the rest of the repo.
- **Branch naming.** The task brief asked for a branch named after the game
  (`berzerk`), while this session is pinned to the pre-assigned branch
  `claude/loving-euler-sywnkw`. The work is committed to the assigned branch,
  since pushing elsewhere is not permitted here.
