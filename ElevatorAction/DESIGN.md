# Elevator Action — Design

How the code works, floor by floor. For the player-facing rules see
[README.md](README.md).

## Concept

A spy is dropped on the roof of a ten-storey building. Secret documents sit
behind the **red doors**; enemy agents pour out of the grey ones. Ride the two
elevators down, empty every red door, and reach the getaway car in the garage
on the ground floor. Shooting is the only answer to an agent, and ducking is
the only answer to an agent's bullet.

## The world

Everything lives in one world coordinate space that is taller than the canvas,
and a camera slides over it:

| Quantity | Value | Notes |
|---|---|---|
| Canvas | 480 × 560 | the viewport |
| World | 480 × 960 | `FLOOR_COUNT * FLOOR_H` |
| Floors | 10 | floor `0` is the garage, floor `9` the roof |
| Floor pitch | 96 px | `FLOOR_H` |
| Floor slab | 8 px | `FLOOR_THICK` |

`floorY(i)` returns the y a character's feet rest at on floor `i`
(`WORLD_H - i * FLOOR_H - FLOOR_THICK`), so floor 0 is at y 952 and floor 9 at
y 88. The camera centres on the player and clamps to `[0, WORLD_H - VH]`, which
is why the roof and the garage both sit fully on screen.

## Simulation

The game is a fixed-timestep loop. `physicsStep(dt)` is the whole simulation —
input sampling, movement, elevators, agents, bullets, scoring — and the
animation loop calls it at `DT = 1/120` while `autoRun && state === 'running'`.
Nothing else mutates game state, so a test can set `autoRun = false` and step
the world by hand, one deterministic tick at a time.

State lives in top-level bindings on purpose (`state`, `score`, `lives`,
`level`, `player`, `elevators`, `doors`, `agents`, `bullets`, `camera`). The
Playwright suite drives the game through exactly those names.

`state` is one of `idle`, `running`, `paused`, `levelclear`, `gameover`, `won`.
`advance()` is the "do the obvious thing" entry point shared by Space, a canvas
click and the Start button.

## Floors, shafts and walking

A floor is a walkable strip broken by the two elevator shafts
(`SHAFT_X = [150, 300]`, 54 px wide). A shaft is a hole: the player may only
cross it when that shaft's car is level with the floor they are standing on
(within `ALIGN_TOL = 7` px). `clampWalk()` does this by finding the open
segment the player is currently inside and keeping them in it, so an
unreachable side of the building stays unreachable until the car is fetched.

## Elevators

Each shaft holds one car. The car only moves while the player is aboard and
holding a vertical key — nothing on the board moves an elevator on its own.
That is a deliberate simplification of the arcade original (where cars can be
sent away and enemies ride them), and it keeps the simulation fully determined
by player input.

- `enterElevator()` — standing on a floor, inside a shaft's footprint, with
  that car aligned, Up or Down boards it.
- Aboard, Up/Down drive the car between `floorY(0)` and `floorY(FLOOR_COUNT-1)`
  at `ELEVATOR_SPEED` (a little faster on later levels), and the player's feet
  track the car.
- `leaveElevator(dir)` — pressing Left or Right while the car is aligned with a
  floor steps off onto that floor, one player-width clear of the shaft.

## Doors and documents

Six door slots per floor (`DOOR_X`), chosen to miss both shafts. `buildLevel(n)`
lays out a deterministic board: a per-level table names which `(floor, slot)`
pairs are red document doors, and the remaining slots on each floor become grey
agent doors. Same level number, same building, every time.

Walking into a red door collects it: `+DOC_POINTS`, the door turns slate grey,
and `docsLeft()` drops. `docsLeft() === 0` is what unlocks the getaway.

## Agents

Agents spawn from grey doors on floors near the player, one every
`spawnInterval` seconds, up to `maxAgents` — both scale with the level. An
agent walks along its own floor toward the player when they share a floor and
patrols its segment otherwise, and fires when it is facing the player, on the
same floor and within `AGENT_RANGE`.

Hit bands are what make crouching work:

| Body | Occupies | Bullet leaves at |
|---|---|---|
| Player standing | `y-34 .. y` | `y-22` |
| Player crouched | `y-18 .. y` | `y-10` |
| Agent | `y-34 .. y` | `y-22` |

An agent's bullet flies at `y-22`, which is *above* a crouched player's head
and squarely through a standing one. A crouched player's own shot still leaves
at `y-10`, inside an agent's band, so ducking costs nothing but speed (you
cannot walk while crouched).

Touching an agent's body is also fatal, so ducking next to one is not a
hiding place.

## Dying, levels and scoring

A hit costs a life, clears every agent and bullet, and drops the player back on
the roof with their collected documents intact. At zero lives the run ends.
Reaching the garage exit (`EXIT_X .. W-12` on floor 0) with every document in
hand clears the level: `+CLEAR_BONUS * level`, then the next building, or `won`
after `LEVEL_COUNT = 3`.

| Event | Points |
|---|---|
| Document | 500 |
| Agent | 300 |
| Level clear | 1000 × level |

The best score is kept in `localStorage` under `elevatoraction-best`, and every
read and write is wrapped in try/catch so the game still runs from `file://`
with storage blocked.

## Rendering

`draw()` paints in world space with the camera translated out: building shell,
floor slabs, shafts and their cables, doors, the garage and its car, then
agents, bullets and the player. Everything is canvas primitives — no sprites,
no audio, no external assets, so the game opens straight from the filesystem.

## Assumptions

Decisions taken without being asked, resolved toward the simpler reading:

1. **Branch name.** The task asked for a branch named after the game
   (`elevator-action`). This session is pinned to a designated branch
   (`claude/compassionate-ramanujan-etnu1p`) and is told never to push
   elsewhere, so the work was developed and pushed there instead; the game name
   is carried by the folder, not the branch.
2. **Elevators are player-driven.** Cars never move on their own and agents
   never ride them. This keeps the board deterministic and the shaft-crossing
   rule easy to read.
3. **Shafts block instead of dropping.** Walking into a shaft with no car at
   that floor is refused rather than letting the player fall down it. Falling
   would need a second movement mode for one rare case.
4. **Red doors collect on contact.** No separate "enter the door" input; the
   simpler reading of "empty the red doors" is to walk into them.
5. **No lights to shoot out.** The arcade original lets the player darken a
   floor by shooting the ceiling lamps. It is a cosmetic risk/reward layer and
   was left out; what it protects against (agents) is already handled by
   shooting and ducking.
6. **No level timer.** Pressure comes from agents and from three lives, not
   from a clock.
7. **One elevator per shaft, two shafts, ten floors, three levels.** Sized so a
   run is a few minutes and the whole board fits one 480 × 560 canvas with a
   vertical camera.
8. **Bullets ignore walls and shafts.** They expire at the world edge. Agents
   only ever shoot along their own floor, so the only thing this changes is a
   long shot sailing over a shaft, which reads fine.
