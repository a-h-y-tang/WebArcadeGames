# Elevator Action — design

## Concept

A single-screen building raid. The player is an agent who enters on the roof of
an eight-floor building, travels between floors in two elevator cars, collects
the documents hidden behind four red doors, and escapes through the ground-floor
exit. Guards walk out of the ordinary doors and shoot along their floor; one hit
either way is fatal. Clearing a building starts a harder one.

Everything is drawn on one 480×640 canvas — the whole building fits on screen,
so there is no camera and no scrolling.

## Mechanics

### The building

- `FLOORS = 8` floors, `FLOOR_H = 68` px apart. `floorY(n)` gives the y of the
  walking surface of floor *n*: floor 1 is at y 568, floor 8 at y 92.
- Two shafts (`SHAFTS`) at fixed x ranges run the full height. Each holds one
  car, which is the only way to change floor.
- Doors live in six fixed x slots per floor (`DOOR_SLOTS`), none of which
  overlaps a shaft. The ground floor gives up its left-most slot to the exit.
- A level is built by `buildLevel(n)` from a seed derived from *n*, so level 3
  always hides its documents behind the same doors. Four doors above the ground
  floor become `kind: 'red'`, each on a different floor.

### Moving

- Walking is horizontal only, at `WALK_SPEED` px/s, clamped to the canvas.
  Floors are continuous: the agent cannot fall, and a shaft the car is not in
  is simply a doorway it can stand in.
- `useElevator(±1)` is the single entry point for ↑/↓ and does one of three
  things, in this order:
  1. riding a stopped car → set the car's target one floor up or down,
  2. standing in a shaft whose car is on this floor → board it (the agent snaps
     to the middle of the car) and send it on its way,
  3. standing in a shaft whose car is elsewhere → call that car to this floor,
     empty.
  A car already in flight ignores everything until it arrives.
- A rider's position is the car's position every step. Pressing ←/→ while the
  car is stopped steps out onto that floor; while it is moving the key is
  ignored.

### Fighting

- `fire()` pushes a bullet from chest height (`CHEST` px above the feet) in the
  facing direction, limited by `FIRE_COOLDOWN` and `MAX_PLAYER_SHOTS` shots in
  the air at once.
- Bullet hits are pure rectangle overlap, so a shot can only hit what is at its
  own height — that is what keeps a shot on floor 6 from hitting a guard on
  floor 3 without any special case.
- Guards (`spawnEnemy`) step out of a plain door, never a red one, and never
  within `SAFE_SPAWN_GAP` of the agent. `pickSpawnFloor()` sends most of them
  (`NEARBY_SPAWN_CHANCE`) to the agent's floor or one next to it, so hiding in
  a corner is not a strategy.
- On the agent's floor a guard walks toward it and shoots when it faces the
  agent within `ENEMY_RANGE`; turning around costs it `TURN_DELAY` seconds of
  held fire, which is the player's window. On any other floor it patrols and
  turns at the walls.
- A guard patrolling a floor the agent is not on runs down `GUARD_PATIENCE` and
  then leaves through a door. Without that, the `maxEnemies` cap could fill up
  with guards stuck on floors the player never visits and the building would go
  quiet — the withdrawal recycles those slots toward the agent.
- A guard's bullet, or walking into a guard, costs a life. `hitPlayer()` clears
  the bullets, puts the agent back on the roof with `INVULN` seconds of grace,
  and ends the run at zero lives. Collected documents are never lost.
- Difficulty is three pure functions of the level number: `maxEnemies`,
  `spawnInterval` and `enemySpeed`.

### Documents and the exit

- Overlapping an unopened red door on your own floor opens it: +`DOC_POINTS`,
  `docsLeft` down one, and the door is drawn as a dark opened frame.
- The exit (`EXIT`, ground floor) only completes the level once `docsLeft` is 0.
  `completeLevel()` pays `LEVEL_BONUS + LIFE_BONUS × lives` and waits for Space;
  `nextLevel()` then rebuilds the building one level harder, keeping score and
  lives.

## Controls

| Input | Action |
|---|---|
| `←` `→` / `A` `D` | walk; step out of a stopped car |
| `↑` `↓` / `W` `S` | call / board / drive an elevator |
| `Space` | start, shoot, dismiss an overlay |
| `P` | pause and unpause |

## Code shape

`game.js` is one flat module, deliberately not wrapped in an IIFE: the
Playwright suite reads and writes the same names the game uses.

- **Constants** — building geometry, actor sizes, scoring.
- **State** — `state` (`idle | running | paused | levelclear | gameover`),
  `score`, `level`, `lives`, `best`, `doors`, `elevators`, `enemies`,
  `bullets`, `docsLeft`, `spawnCd`, `player`, `keys`, `autoRun`.
- **Geometry helpers** — `floorY`, `shaftAt`, `playerRect`, `enemyRect`,
  `doorRect`, `exitRect`, `overlaps`.
- **`physicsStep(dt)`** — the whole simulation for one fixed timestep, in
  order: timers, cars, the rider, walking, documents, the exit, guard spawning,
  guards, bullets, contact damage, HUD. It returns immediately unless
  `state === 'running'`, so pausing and the overlays need no other guard.
- **`draw()`** — rendering only; it never changes state.
- **Main loop** — accumulates real time and calls `physicsStep(DT)` a whole
  number of times per frame, but only while `autoRun` is true. Tests set
  `autoRun = false` and call `physicsStep` themselves, which makes every test
  deterministic.

`rng()` is a small LCG seeded per level, so "random" layouts and guard
spawns replay identically.

## Testing

`tests/elevator-action.spec.js` drives the page from `file://` with Playwright.
The suite was written before the game and covers: the idle page and HUD,
building geometry (floors, shafts, doors clear of shafts, the exit), walking and
its clamps, all three elevator behaviours plus boarding, riding, stepping out
and the floor limits, shooting (direction, cooldown, shot limit, height-based
hits, kills and scoring), guards (spawning from plain doors only, chasing,
patrolling, firing rules, reloading, the per-level caps), getting hit (lives,
respawn, grace period, game over, best score), documents and the exit,
pausing, the live animation loop, and the repository integration (catalogue
entry, README row, screenshot, docs).

## Assumptions

These were decisions taken where the brief left room; the simpler reading won
each time.

- **Branch name.** The brief asked for a branch named after the game, but the
  session's standing instruction pins development to
  `claude/compassionate-ramanujan-4m74xu`. The standing instruction wins, so
  the work lives there and no `elevator-action` branch was pushed.
- **No falling.** Floors are solid across their whole width; a shaft without a
  car is a doorway you can stand in, not a hole. This keeps the controls to
  walk/ride/shoot with no jump.
- **No escalators.** The original arcade game mixes elevators and escalators.
  Only elevators are modelled.
- **One car per shaft, player-driven.** Cars have no schedule of their own:
  they move only when boarded or called, one floor per request.
- **Guards stay on their floor.** They never ride, so riding is a safe moment
  and the chase stays readable. Instead of chasing you up the building, a guard
  left alone on an empty floor gives up and withdraws, and a fresh one is sent
  to where you actually are.
- **No crushing.** The arcade game lets you squash a guard with a car; here a
  car passes guards harmlessly.
- **Four documents, one per floor, never on the ground floor**, so the route
  down is always a tour of four different floors.
- **Endless levels.** There is no final building; levels keep getting harder
  (more, faster guards arriving sooner) and the run ends when the lives do.
- **Shooting is allowed from inside a car**, because forbidding it needs a rule
  the player cannot see.
- **Contact with a guard is fatal** rather than merely blocking, so walking
  into one is as costly as being shot.
