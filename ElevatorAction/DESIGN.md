# Elevator Action — Design

## Concept

A top-to-bottom infiltration game on a single HTML5 canvas, in the spirit of
Taito's *Elevator Action*. You are a spy who drops onto the roof of a sixteen
storey building. Somewhere inside, behind the red doors, are the secret
documents. Collect every one of them, ride the elevators down to the basement
and walk out of the getaway exit before the building's agents gun you down.

The building is taller than the viewport, so the camera scrolls vertically to
follow the player. Vertical movement is only possible by elevator: there are no
stairs, so each elevator's limited shaft range is the real puzzle of the level.

## World model

The building is a stack of `FLOORS = 16` floors, each `FLOOR_H = 60` px tall, in
a world `BUILDING_W = 720` px wide and `FLOORS * FLOOR_H = 960` px tall. The
canvas is `720 x 480`, so eight floors are on screen at a time.

Everything that stands on a floor is positioned by its **feet**: a floor's
walking surface is `floorY(f) = (f + 1) * FLOOR_H - SLAB_H`. An actor occupies
`x - w/2 .. x + w/2` horizontally and `y - h .. y` vertically, which makes all
collision tests plain rectangle/point maths with no tile grid to maintain.

- **Floor 0** is the roof entry; the player starts there on the right.
- **Floor 15** is the basement. Its left end (`x <= EXIT_X`) is the getaway exit.
- **Doors** sit in four fixed slots per floor (`DOOR_SLOTS = [60, 240, 440, 640]`,
  each `DOOR_W = 44` wide). A slot is empty, a **red door** (one secret
  document) or a **blue door** (an agent spawn point). Each level is literally
  sixteen four character strings, one per floor, so the layout is data and the
  tests can assert against it.
- **Elevators** run in three shafts whose x positions never overlap a door slot.
  Each shaft covers a limited band of floors, which forces the player to
  transfer part way down:

  | Shaft | x | floors |
  |---|---|---|
  | A | 150 | 0 – 7 |
  | B | 360 | 4 – 11 |
  | C | 570 | 8 – 15 |

## Mechanics

### Elevators — summon and ride

One rule covers both calling an elevator and driving it. While the player is
standing inside a shaft's x span and the shaft reaches the player's floor,
holding `↑` / `↓`:

- moves the car **towards the player** at `CALL_SPEED` if the car's deck is more
  than `SNAP` px away (summoning it), and
- once the deck is level with the player (`|car.y - player.y| <= SNAP`), the
  player boards and the same key drives the car in the pressed direction at
  `CAR_SPEED`, clamped to the shaft's floor range.

A summoned car never crushes the player — it stops level with them. Pressing
`←` / `→` while riding steps the player off, but only when the deck is within
`SNAP` of some floor; park the car between floors and the player is stuck there,
which is also the safest place in the building because every bullet flies at
floor height.

### Documents

Walking over a red door opens it and takes the document inside: `docsLeft`
drops by one. The exit in the basement is inert until `docsLeft === 0`, so a
premature trip to the bottom is wasted. Doors already taken stay open and score
nothing.

### Agents, shooting and crouching

Agents emerge from blue doors. A spawner picks a blue door on a floor near the
player every `spawnInterval` seconds, up to `maxEnemies` alive at once, and
never one within `SPAWN_CLEARANCE` of the player themselves — walking past a
blue door should not be an unavoidable death. An agent walks towards the
player's x on its own floor, stopping at `ENEMY_STANDOFF`, and fires on a
cooldown once the player is on its line and within `ENEMY_RANGE`. A player
stopped between floors is on nobody's line, so a parked car is cover.

Bullets are points that travel horizontally and are tested against actor
rectangles, so **height is the whole combat system**:

- a standing actor is `PLAYER_H = 34` tall and fires from `feet - 22`;
- a crouching player is `CROUCH_H = 18` tall, so a bullet aimed at `feet - 22`
  passes clean over them;
- a crouching player fires from `feet - 10`, which is still inside a standing
  agent's box.

Crouching (`↓` while standing on a floor) is therefore strictly safer but roots
the player in place. Agents never crouch.

The second way to kill an agent is the elevator: a moving car whose body
vertically overlaps an agent standing in its shaft crushes it, worth more than a
bullet.

### Lives and scoring

The player has `3` lives. A hit clears the floor of agents and puts the player
back at the roof entry; documents already collected stay collected. Running out
of lives ends the game.

| Event | Points |
|---|---|
| Secret document | 500 |
| Agent shot | 100 |
| Agent crushed by an elevator | 300 |
| Escape through the basement exit | 1000 |

Three levels add agents, speed and documents. Clearing the third wins the game.
The best score is kept in `localStorage` under `elevatoraction-best`.

## Controls

| Input | Action |
|---|---|
| `←` `→` or `A` `D` | walk; step off a car that is level with a floor |
| `↑` `↓` or `W` `S` | summon / drive the elevator in the shaft you are standing in |
| `↓` or `S` | crouch, when you are on a floor and not in a shaft with a reachable car |
| `Space`, `Z` or `X` | fire |
| `Space` / `Enter` | start, or restart after game over |
| `P` | pause |

## Code structure

`game.js` is a single classic (non-module) script, matching Gold Runner,
BurgerTime, Snake and the rest of the repo: every piece of state (`state`,
`player`, `enemies`, `bullets`, `elevators`, `doors`, `docsLeft`, `keys`) and
every helper (`step`, `startGame`, `shoot`, `spawnEnemyAt`, `floorY`) is a plain
global, so the Playwright specs can reach in and drive the simulation.

All motion is expressed per second and applied by `step(dt)`. The
`requestAnimationFrame` loop only calls `step` when the `autoStep` flag is on,
so a spec can switch it off and advance exactly the frames it wants — the whole
suite is deterministic and never waits on wall clock timing.

Order inside `step(dt)`: player input, which covers walking, crouching and the
elevator → door pickups → the agent spawner → agent movement and firing →
bullets → the elevator crush → agent contact → the basement exit → camera and
HUD. The crush is settled before contact so that a car running an agent down
resolves as a kill rather than as a collision with the rider standing on its
deck.

## Assumptions

Decisions made without a human to ask, kept to the simpler reading each time:

1. **Branch name.** The task asked for a branch named after the game
   (`elevator-action`), but this session is required to develop and push on its
   designated branch `claude/compassionate-ramanujan-7dzrq7`. The hard branch
   requirement wins; the game name lives in the folder name instead.
2. **Floors are continuous.** The original leaves open hoistways you can fall
   into. Here the slab runs unbroken across a shaft, so walking is never blocked
   and nobody falls. This is what makes agents crushable (they wander across
   shafts) and it removes a whole class of edge cases around a player standing
   in mid-air.
3. **Agents do not use elevators.** They patrol the floor they were born on.
   Vertical pursuit would need a second elevator controller fighting the
   player's own input for the same car.
4. **No escalators, no ceiling lamps.** The original's escalators and
   shoot-the-lights-out gimmick are dropped; the elevator crush covers the same
   "kill without a bullet" role.
5. **Documents are taken on contact,** not by pressing a key at the door. One
   fewer control, and nobody can walk past a document by accident.
6. **A death respawns at the roof** rather than resetting the level. Losing
   already collected documents on every hit made the game punishing to no
   obvious end.
7. **Three levels** is treated as "a complete game". Clearing level 3 is a win
   rather than looping forever at rising difficulty.
8. **`Space` does double duty** — it starts the game from the idle/over screen
   and fires while playing. Harmless overlap, one fewer key to explain.
