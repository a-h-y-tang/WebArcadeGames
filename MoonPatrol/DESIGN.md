# Moon Patrol — Design

## Concept

A side-scrolling arcade game inspired by Irem's 1982 classic *Moon Patrol*.
You drive a moon buggy across the lunar surface at a fixed screen position
while the world scrolls past. The surface is strewn with **craters** you must
jump over and **rocks** you can either jump or shoot, while **UFOs** swoop in
from above. The buggy fires in two directions at once — a shot forward to
clear rocks and a shot upward to knock down UFOs — just like the original.

Survive as long as you can: distance travelled and enemies destroyed both add
to your score. Crash into a crater, rock, or UFO and you lose one of your
three buggies. Lose them all and the patrol is over.

## Mechanics

- **The world scrolls** left at a speed that slowly ramps up with distance.
  The buggy stays at a fixed horizontal position.
- **Jumping** launches the buggy in a gravity-driven arc. While airborne the
  buggy clears craters and can pass over rocks.
- **Firing** creates two bullets from one press: a *forward* bullet at ground
  height (destroys rocks) and an *up* bullet from the buggy (destroys UFOs).
- **Craters** are pits in the surface. Being over a crater while on the ground
  is a crash; you must be airborne to pass. Craters cannot be shot.
- **Rocks** sit on the surface. Driving into one is a crash; jump over it or
  blast it with a forward bullet for points.
- **UFOs** drift in and descend toward the buggy. Contact is a crash; shoot
  them with an up bullet for points.
- **Crashing** costs one buggy and grants a brief invulnerability window
  during which the immediate hazards around the buggy are cleared so you can
  recover. At zero buggies the game ends.
- **Best score** is persisted to `localStorage` under `moonpatrol-best`.

## Controls

- **Space / ↑ / W** — jump.
- **F / ↓ / S** — fire (forward + up).
- **Enter** — start / restart from the idle and game-over screens.
- **P** — pause / resume.

## Architecture

Follows the conventions of the other games in this repo:

- A single non-module `game.js` so all state and logic are reachable from the
  Playwright tests as plain globals, mirroring Dino Run and Snake.
- All motion is expressed per-second and advanced through `step(dt)`, which
  the tests call directly to simulate frames deterministically without relying
  on `requestAnimationFrame` wall-clock timing. Integration runs in small
  fixed sub-steps so fast bullets and a fast-scrolling world never tunnel
  through collisions.
- The real-time loop (`frame`) simply funnels elapsed time into the same
  `step(dt)`, then draws.
- Spawning is controllable: `spawnRock`, `spawnCrater`, and `spawnUfo` let
  tests place hazards exactly; a live spawner (gated by the `autoSpawn` flag)
  drops them on a distance timer during normal play.

Key globals exposed for testing: `state`, `score`, `best`, `lives`,
`distance`, `speed`, `buggy`, `rocks`, `craters`, `ufos`, `bullets`,
`autoSpawn`, and the functions `startGame`, `step`, `jump`, `fire`,
`spawnRock`, `spawnCrater`, `spawnUfo`, `togglePause`, `buggyBox`.

## Assumptions

- **Fixed buggy x-position.** As in the original, the buggy does not move
  horizontally; all challenge comes from timing jumps and shots against the
  scrolling terrain. Simpler, fully deterministic interpretation.
- **Airborne = crater-safe.** Any time the buggy is off the ground it clears a
  crater, rather than modelling partial wheel contact. Simpler interpretation,
  noted per instructions.
- **A crash clears nearby hazards** during the invulnerability window so the
  player cannot be caught in an unavoidable multi-crash, and progress is not
  reset to a checkpoint (checkpoints are omitted for simplicity).
- **UFOs are the only aerial threat** and descend on a fixed velocity rather
  than using pursuit AI, keeping their behaviour deterministic and testable.
- **Landscape 600×260 canvas** to sit comfortably alongside the other games.
