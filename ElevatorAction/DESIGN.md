# Elevator Action — Design

## Game concept

You are an agent who has entered a ten-storey building from the roof and has to
get back out at street level. Six **red doors** scattered up and down the
building hide the documents you came for; the **blue doors** are where the
building's own agents come from. The street exit on the bottom floor stays
locked until all six documents are in hand, so the run is a descent with a
shopping list.

The building has no stairs. Movement between floors happens entirely in three
**elevator shafts**, and no single shaft runs the whole height — each one serves
a slice of the building, and consecutive slices overlap. The descent is a relay:
ride a car as far as it goes, step off onto a floor the next shaft also serves,
walk across to it, ride on. Walking a corridor is only ever a means of getting
from one shaft to a door, or from a door to the next shaft, which is where the
enemy agents get their chance.

Three levels, three lives, one score. Dying puts you back on the roof with the
documents you already have; running out of lives ends the run, and the best
score is remembered between sessions.

## Playfield and geometry

| Constant | Value | Meaning |
|---|---|---|
| `W` × `H` | 900 × 600 | canvas size in CSS pixels |
| `FLOORS` | 10 | floor 0 is the roof entrance, floor 9 the street |
| `FLOOR_H` | 90 | floor-to-floor height |
| `BUILDING_LEFT` / `BUILDING_RIGHT` | 40 / 860 | the corridor walls |
| `SHAFT_W` | 72 | width of an elevator shaft |
| `ELEV_SPEED` | 72 px/s | car speed while a direction key is held |
| `ALIGN_TOL` | 12 px | how close to a floor line still counts as "level" |
| `SLAB_H` | 6 | thickness of a floor slab |
| `DOOR_W` × `DOOR_H` | 46 × 58 | a door |
| `PLAYER_SPEED` | 150 px/s | walking speed |
| `STAND_H` / `CROUCH_H` | 38 / 22 | the agent's height standing and crouched |

The building is 900px tall and the canvas 600px, so the view scrolls: `cam.y`
keeps the agent 60% of the way down the viewport and clamps at the roof and the
street. `floorY(i) = (i + 1) * FLOOR_H` is the walking surface of floor `i`,
which leaves a storey's worth of room above floor 0 to draw its ceiling.

### The shafts

| Shaft | x | Floors served |
|---|---|---|
| A | 230 | 0 – 4 |
| B | 450 | 3 – 7 |
| C | 670 | 6 – 9 |

Each car starts parked at the top floor of its own shaft, which happens to lay
out a clean opening route: shaft A from floor 0 to 3, where shaft B's car is
already waiting; shaft B to floor 6, where shaft C's car is waiting; shaft C to
the street.

Corridors run the full width of the building and shafts never interrupt them: an
empty shaft is something you walk across, not into. Boarding is a deliberate
press of **up or down while standing on a car that is parked level with your own
floor** (within `ALIGN_TOL`). Nothing ever falls, and no door is ever walled off
from the elevator that serves its floor.

That last point is not decoration. The first cut of this game made a shaft a
solid wall unless its car was level with you, which read well and removed falling
for free — but it also cut every floor into up to four segments, and a walk of
the reachable segments showed that the documents on floors 2 and 7 could not be
got at from the shaft that served them. The wall rule had to go.

Because a car only ever moves while the agent is riding it, the agent always has
the car they just stepped out of parked at their own floor, so the descent can
always be retraced.

### Doors

Doors sit at x = 120, 340, 560 and 780 on every floor, which keeps every one of
them clear of every shaft. The bottom floor gives its rightmost slot up to the
street exit. Six doors are red:

| Floor | Door x |
|---|---|
| 1 | 120 |
| 2 | 780 |
| 4 | 340 |
| 5 | 560 |
| 7 | 120 |
| 8 | 780 |

The red doors deliberately alternate between the left and right ends of the
building, so collecting them means crossing a corridor rather than stepping off
the elevator into one.

## Mechanics

### Walking and riding

On a floor, left/right walks and sets the facing direction, clamped only by the
two corridor walls. Standing on a car that is level with your floor, up or down
boards it and starts it moving the same frame.

On a car, up/down drives it between the limits of its own shaft and the agent
rides along. Releasing both keys parks the car on the nearest floor line if it is
already within `ALIGN_TOL` of one — so you brake as you come up on a floor, and
the car settles exactly level. While the car is level, left/right walks out onto
that floor; while it is between floors, left/right only shuffles the agent inside
the car. A green lamp on the car lights whenever it is level and safe to leave.

`ALIGN_TOL` is 12px against a car speed of 72px/s, so the window in which a floor
counts as level lasts a third of a second — tight enough to be a skill, loose
enough not to be a lottery.

### Shooting and crouching

`Space` fires at hip height in the direction the agent faces: 420 px/s, three
bullets in the air at once, 0.22s between shots. Enemy agents fire at the same
height but at 300 px/s, with a 1.4s reload and a 340px range down their own
floor.

Holding **down** while on a floor crouches instead of moving. A crouched agent
is 22px tall and an enemy bullet flies at 26px, so crouching is a clean dodge —
and since crouching also stops you walking, the cost is the time it takes.
Bullets are not blocked by shafts, so an enemy across a shaft on your floor can
still shoot at you.

### Enemy agents

Agents spawn from blue doors within three floors of you, at most a few seconds
apart, up to a per-level cap. On your floor they walk at you and shoot; elsewhere
they patrol their own corridor, turning at the walls. They never ride the cars,
so an agent stays on the floor it came out on — but the corridor is theirs end to
end, so there is nowhere on that floor you can outwalk them.

| Level | Enemy cap | Enemy speed | Spawn interval |
|---|---|---|---|
| 1 | 5 | 60 px/s | 2.4s |
| 2 | 6 | 74 px/s | 2.0s |
| 3 | 7 | 88 px/s | 1.6s |

### Scoring

| Event | Points |
|---|---|
| Document taken | 500 |
| Enemy agent shot | 300 |
| Level cleared | 1000 |

Touching an enemy, or being shot by one, costs a life. The agent restarts on the
roof with the field cleared and every car back at the top of its shaft; the
documents already collected stay collected.

## Controls

| Input | Action |
|---|---|
| `←` `→` / `A` `D` | walk, or step out of a level car |
| `↑` `↓` / `W` `S` | drive the car you are standing in |
| `↑` / `W` at a red door | take the document |
| `↓` / `S` on a floor | crouch (rides the car instead when you are standing on one) |
| `Space` | shoot, or start / dismiss an overlay |
| `P` | pause and unpause |

## Code layout

- `index.html` — page shell, HUD, canvas and overlay.
- `style.css` — the dark panel-and-stat look shared with the rest of the repo.
- `game.js` — all of the game. The simulation runs on a fixed 1/120s timestep
  through `physicsStep()`, which early-returns unless `state === 'running'`.
  Everything interesting lives at the top level (`state`, `score`, `level`,
  `lives`, `docs`, `player`, `enemies`, `bullets`, `elevators`, `doors`, `cam`)
  because the Playwright suite drives the game through exactly those names, with
  `autoRun = false` to freeze the animation loop and step the simulation by hand.
- `tests/elevator-action.spec.js` — the suite, written before the game.

`physicsStep()` runs in a deliberate order: move the agent, move the enemies,
move the bullets (agent bullets resolve before enemy ones, so an agent dropped
this frame cannot shoot back), spawn, check contacts, check doors and the exit,
move the camera. A death ends the step immediately so nothing else touches a
world that has just been reset.

## Assumptions

These were decisions made without anyone to ask, resolved toward the simpler
reading and recorded here.

- **Branch name.** The task asked for a branch named after the game
  (`elevator-action`); the session's standing instructions pin all work to the
  branch `claude/compassionate-ramanujan-8au5n8`. The standing instruction wins,
  so the game ships on that branch rather than one of its own.
- **No stairs or escalators.** The arcade original has escalators alongside the
  elevators. Here the elevators are the only way between floors, which makes the
  overlapping-shafts relay the whole of the navigation puzzle.
- **No falling.** An empty shaft is walked across rather than fallen into, which
  removes falling, mid-air state and death-by-shaft entirely. The alternative —
  walling off empty shafts — was tried first and made two of the six documents
  unreachable, which is what settled it.
- **Cars only move while ridden.** Unattended cars stay where they were left
  instead of being driven around by the building. It keeps the simulation
  deterministic and guarantees the agent can always reach the car they just left.
- **Enemies ignore the elevators.** Enemy agents stay on the floor they spawned
  on. Within it they roam the whole corridor, so an agent on your floor is always
  a problem you have to solve rather than one you can walk away from.
- **The exit is locked, not penalised.** The original lets you leave early at a
  cost; here the exit simply does not open until all six documents are in hand.
- **Crushing is not modelled.** The original kills enemies caught under a
  descending car. Cars here pass harmlessly, and shooting is the only way to deal
  with an agent.
- **Three levels.** The run is finite and ends in a win rather than looping for
  score, matching how the other games in this repo are structured. Levels differ
  only in enemy count, speed and spawn rate — the building itself is fixed, so a
  run is always the same descent.
- **One car per shaft.** Enough for the relay, and it keeps "is the car here?"
  a single unambiguous question on every floor.
