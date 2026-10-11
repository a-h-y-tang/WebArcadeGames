# Elevator Heist — Design

## Concept

You are a spy at the top of a six-storey office block. Secret documents sit
behind the red doors scattered over the floors. Grab every one of them, ride
the building's two patrolling elevators down to the ground floor, and slip out
through the getaway exit on the right — all while enemy agents pour out of the
doors behind you.

The hook is the building itself. Each floor is cut into three corridor segments
by the two elevator shafts, and you can only cross a shaft while a car happens
to be level with your floor. The cars never stop moving, so the building's
geometry keeps re-arranging itself: a route that was open a second ago is a
hole in the floor now. Enemy agents can never cross a shaft, which turns every
car arrival into both an escape route and an ambush.

## Mechanics

### The building

- Six floors, floor `0` at the top, floor `5` at the bottom. `floorY(f)` gives
  the walking surface (the player's feet level) of floor `f`.
- Two elevator shafts cut vertical gaps through every floor. A gap is
  `SHAFT_W` wide, centred on `SHAFT_XS[i]`.
- One elevator car runs in each shaft. Cars patrol between the top and bottom
  floor at `ELEVATOR_SPEED` and reverse at each end — they are never idle.
- The ground floor holds the exit on the right (`EXIT_X`).

### Walking and the shafts

- A shaft gap is a hole in the floor. Walking into it is blocked unless a car
  is level with your floor (within `LEVEL_EPS`), in which case you step onto
  the car and are riding it.
- While riding, your feet follow the car. You can walk out of the gap only
  while the car is level with a floor; mid-shaft you are penned inside the car.
  Stepping out snaps you to that floor's surface.
- Walking straight from one car into the other across a segment works exactly
  the same way, so the two shafts can be chained when both cars line up.

### Riding

- A car you are standing on obeys your `up`/`down` keys, overriding its patrol
  direction for as long as you hold the key; it keeps the last direction you
  gave it after you step off.
- Cars you are not on continue their automatic patrol, which is what stops the
  building from deadlocking: a car always comes back round to your floor.

### Crouching and gunfire

- Bullets are fired at the shooter's chest height: `26px` above the feet
  standing, `12px` crouched. A body is `PLAYER_H`/`ENEMY_H` tall standing and
  `CROUCH_H` crouched.
- That one rule produces the whole duel: a standing shot sails over a
  crouching target, a crouched shot still hits a standing one, so crouching is
  a dodge that does not disarm you. You cannot walk while crouched.
- Bullets carry an absolute `y`, so they can only ever hit something on the
  same floor; no floor test is needed anywhere in the collision code.
- You may have `MAX_PLAYER_BULLETS` rounds in flight, limited further by a
  short cooldown.

### Agents

- Agents emerge from doors on floors near you, walk toward you when you share
  a floor, and fire when they are facing you and within `ENEMY_RANGE`.
- They turn back at walls and at shaft edges and never ride a car, so each
  agent is confined to one corridor segment.
- They are killed by a single bullet (`ENEMY_POINTS`). Walking into one is
  fatal, as is being shot.
- Spawning accelerates and agents move faster on later levels, up to a cap.

### Documents and scoring

- Each level has `docsTotal` (3) red document doors. Standing in front of one
  opens it and banks the document: `DOC_POINTS`.
- Reaching the exit with documents still outstanding does nothing. With all of
  them collected it clears the level for `LEVEL_BONUS`, and the next level
  loads a new door layout (the three layouts cycle).
- Dying costs a life, clears the agents and bullets, and drops you back at the
  top floor with your collected documents intact. `START_LIVES` lives; the best
  score persists in `localStorage` under `elevatorheist-best`.

## Controls

| Input | Action |
|---|---|
| `←` `→` / `A` `D` | Run left / right |
| `↑` `↓` / `W` `S` | Drive the car you are riding |
| `↓` / `S` (on a floor) | Crouch — dodges standing gunfire |
| `Space` / `J` | Shoot |
| `P` | Pause |
| `Space` / `Enter` | Start, or resume from pause |

## Code shape

`game.js` is a single classic (non-module) script, matching Gold Runner,
BurgerTime and the rest of the repo: all state and helpers are plain globals so
the Playwright specs can reach them. Every speed is expressed per second and
the whole simulation advances through `step(dt)`, so the tests drive time
themselves rather than waiting on `requestAnimationFrame`. Two flags exist for
the tests: `autoStep` (switch off the rAF-driven stepping) and `autoSpawn`
(switch off the agent spawner so a spec can place exactly the agents it cares
about).

Floors are continuous positions rather than a tile grid — the elevators need
sub-floor `y` values — but every interaction is still decided by a small set of
pure predicates: `gapAt(x)` (which shaft gap an `x` falls in), `carLevelFloor(car)`
(which floor a car is level with, or `null`), and `hits(bullet, x, y, w, h)`.

## Assumptions

Decisions taken without asking, resolved toward the simpler reading:

1. **Branch.** The scheduled prompt asks for a branch named after the game, but
   this session is also pinned to the designated branch
   `claude/compassionate-ramanujan-lslpuu`, which is the only branch it may
   push. The designated branch wins; the game name lives in the folder, the
   commit and the PR title instead.
2. **No vertical scrolling.** The whole six-storey building fits in the
   540px-tall canvas, so there is no camera to move. The original arcade game
   scrolls through roughly thirty floors.
3. **Cars patrol automatically.** In the arcade original the player drives the
   elevators outright. Here an unoccupied car keeps patrolling, which removes
   the deadlock where the only car you could ride is parked on a floor you
   cannot reach.
4. **No elevator crush.** Because walking into an unserved shaft gap is simply
   blocked, the player can never be standing under a descending car, so the
   original's crush death has nothing to trigger it.
5. **Agents stay on their floor.** They never ride cars and never cross a
   shaft, which keeps their behaviour decidable and makes a corridor segment a
   readable unit of threat. They also never crouch.
6. **Contact is fatal.** Touching an agent kills, which gives them a threat
   even at point-blank range where shooting is awkward.
7. **Fixed document count.** Every level has exactly three documents; later
   levels change the layout and the agent pressure rather than the quota.
8. **Shaft crossing is centre-based.** Blocking tests the player's centre `x`
   against the gap, not their full width, so a sliver of the sprite may
   overhang the opening. It keeps the predicate a single comparison.
