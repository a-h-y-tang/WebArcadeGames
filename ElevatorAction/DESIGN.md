# Elevator Action — Design

## Game concept

Elevator Action is a vertical infiltration game. A spy drops onto the top floor
of a ten-storey building, works down through it on two elevators, raids the
**red doors** for secret documents, and escapes through the lobby exit. Enemy
agents step out of the **grey doors** and shoot on sight.

The building is the puzzle. Each floor is a solid slab except where the two
elevator shafts cut through it, so the only way down is a car — or a fall down
an empty shaft onto whatever is below. Documents are scattered one per floor
across five different floors, so a run means working the whole building rather
than riding straight to the bottom.

Five documents per building, three lives, three buildings. The exit stays shut
until the last document is in hand; once it is, the lobby doorway lights up and
reaching it banks an escape bonus plus a bonus for every life still in hand.

## Playfield and geometry

| Constant | Value | Meaning |
|---|---|---|
| `W` × `H` | 480 × 640 | canvas size in CSS pixels |
| `WORLD_H` | 800 | world height; the camera scrolls vertically |
| `FLOOR_COUNT` | 10 | storeys, index `0` = top floor, `9` = lobby |
| `FLOOR_H` | 76 | spacing between floor surfaces |
| `TOP_MARGIN` | 56 | world y of the top floor's surface |
| `SHAFTS` | x 112 and 312, width 56 | the two elevator shafts |
| `CAR_W` × `CAR_H` | 56 × 10 | a car fills its shaft exactly |
| `DOOR_X` | 56, 240, 424 | door centres, all clear of both shafts |
| `EXIT` | x 396, width 64 | escape doorway, lobby floor only |

`FLOOR_Y[i] = TOP_MARGIN + i * FLOOR_H`, so floor surfaces sit at
`56, 132, … 740`. Everything in the game model is in **world** coordinates;
the camera (`cameraY()`) only shifts what `draw()` paints, so the simulation and
the tests never have to think about scrolling.

A car fills its shaft's full width on purpose. If the car were narrower there
would be a sliver either side of it where the floor is missing and the car is
not underfoot, and a spy walking off a parked car would drop through it.

## Rules and numbers

| Constant | Value | Meaning |
|---|---|---|
| `MOVE_SPEED` | 120 px/s | walking speed |
| `CAR_SPEED` | 90 px/s | elevator travel |
| `CAR_DWELL` | 0.3 s | a car's pause at each floor it reaches |
| `GRAVITY` | 900 px/s² | pull down an open shaft |
| `BULLET_SPEED` | 320 px/s | shots, horizontal only |
| `SHOOT_DELAY` | 0.22 s | the spy's rate of fire |
| `AGENT_FIRE_DELAY` | 1.8 s | an agent's rate of fire |
| `AGENT_RANGE` | 210 px | how far down a floor an agent will shoot |
| `INVULN_TIME` | 2.2 s | blinking grace period after a hit |
| `KNOCKBACK` | 28 px | shove away from the agent that landed the hit |
| `LIVES_START` / `LIVES_MAX` | 3 / 5 | lives at the start, and the ceiling |
| `LEVEL_COUNT` | 3 | buildings in a full run |
| `DOC_COUNT` | 5 | documents per building |
| `DOC_POINTS` | 500 | per document |
| `AGENT_POINTS` | 150 | per agent dropped |
| `ESCAPE_BONUS` / `LIFE_BONUS` | 1000 / 250 | escape bonus, and per life left |

Clearing a building hands back one life, up to `LIVES_MAX`. A scripted
playthrough left the first building with one life of three still in hand, which
makes a three-building run a matter of attrition rather than skill; a life per
building keeps the run going without making the escape bonus pointless, since
the bonus still pays for every life you did *not* spend.

Each later building raises the pressure rather than the geometry:
`spawnDelay()` shortens (`3.8 s / (1 + 0.4·(level−1))`), `maxAgents()` rises
(`1 + level`) and `agentSpeed()` climbs by 9 px/s per level.

An agent can only reach a spy standing on the same floor as them — by shot or
by touch. A spy in transit, riding a car between floors or falling, is out of
reach. (Parking a car level with a floor counts as standing on it, so the
elevator is cover while it moves, not a safe room.) That makes the elevator worth riding
rather than a slow lift between two shooting galleries, and it gives the player
a way to break off a fight that walking alone cannot.

## How the code works

`game.js` keeps all the interesting state at the top level — `state`, `score`,
`level`, `lives`, `player`, `elevators`, `doors`, `agents`, `bullets` — so the
Playwright suite can place a situation precisely and step the simulation. The
animation loop only advances the model while `autoRun` is true; a test sets
`autoRun = false` and calls `physicsStep(DT)` itself, which makes every
assertion about motion exact instead of timing-dependent.

`physicsStep(dt)` runs one fixed step in a deliberate order:

1. tick the spy's cooldown and invulnerability, door-open flashes and sparks;
2. `movePlayer` — horizontal walking, wall clamp, and the held-key re-drive that
   keeps a parked car moving on floor after floor;
3. `moveElevators` — a car travels toward `FLOOR_Y[target]` and **always stops
   level with a floor**, which is what lets the spy walk off onto the slab.
   Pressing the opposite direction in transit retargets the car to the floor it
   left, so an overshoot or an agent waiting below can be backed out of. On
   arrival a car waits `CAR_DWELL` before a *held* key can send it on — without
   that pause it departs the same frame it arrives and there is no instant in
   which to step off it, which is exactly how a scripted playthrough got stuck
   riding one car for two minutes. An explicit press is never delayed;
4. `resolvePlayerVertical` — riding or falling (below);
5. `moveAgents` — chase, wall turns, shooting, and contact damage, which comes
   with a shove clear of the agent: without it the agent is still standing on
   the spy when the grace period ends and takes the next life for free;
6. `moveBullets` — travel, agent hits, spy hits;
7. agent spawning, document pickup, and the exit check.

### Standing, riding and falling

Vertical movement is one rule. While `player.onCar` is set and the spy is still
over that car's span, the spy is simply pinned to the car's roof — that carries
them both up and down. Step off the span and `onCar` clears and gravity takes
over: `supportBetween(x, from, to)` returns the highest surface the feet sweep
through, considering floor slabs (which hold everywhere except over an open
shaft) and car roofs. The lobby slab closes both shafts off, so a long fall ends
on the lobby floor rather than off the bottom of the world.

Where a floor surface and a car roof sit at the same height, the car wins. That
tie only arises in the lobby, whose slab closes both shafts off; if the slab won
it, a car parked in the lobby could not be boarded at all and a spy who got down
there with documents still above them would be stranded for good. A scripted
playthrough found exactly that, two minutes of a bot standing in a lobby holding
the call button.

A fall costs nothing but time — see *Assumptions*.

### Call buttons

The same up/down keys do double duty. Standing on a car they drive it; standing
on a floor they work a call button, and `callElevator()` sends the nearer idle
car to the spy's floor. This exists because of a hole found while scripting a
playthrough: a car can only be driven from inside, so a spy who drops down a
shaft past both cars has no way back up, and a run with documents left above
them is unwinnable with no way to end it but dying. The call button closes that
off while leaving the shafts as the fast, risky route down.

### Doors

`buildLevel(n)` lays out three doorways on every floor above the lobby, then
seeds a small deterministic PRNG (`mulberry32(1337 + n·7919)`) and picks
`DOC_COUNT` **different floors**, one red door on each. The same level number
therefore always produces the same building, which keeps the suite reproducible
while still giving each of the three buildings its own layout. Agents come out
of grey doors within `SPAWN_RANGE` floors of the spy, never from a doorway
within 48 px of them, so nobody spawns on top of the player.

Walking into a red doorway takes the document; the lobby has no doors at all, so
it is a clean run from the last elevator to the exit.

## Controls

| Input | Action |
|---|---|
| <kbd>←</kbd> <kbd>→</kbd> / <kbd>A</kbd> <kbd>D</kbd> | walk |
| <kbd>↑</kbd> <kbd>↓</kbd> / <kbd>W</kbd> <kbd>S</kbd> | riding: drive the car one floor per press (hold to keep going). On a floor: call the nearer idle car to you |
| <kbd>Space</kbd> / click | shoot — and start, resume or continue from an overlay |
| <kbd>P</kbd> | pause |

## Assumptions

These are the calls made where the brief left room, each resolved toward the
simpler reading:

- **Branch name.** The task asked for a branch named after the game
  (`elevator-action`), but this session is also instructed to develop and push
  only on its designated branch. The designated branch wins; all the work for
  the game sits there.
- **No fall damage.** In the arcade original, dropping down a shaft is fatal.
  Here a fall just drops the spy onto the next car roof or the lobby floor. It
  keeps the shafts usable as a deliberate shortcut and removes a whole class of
  fiddly death rules.
- **Documents are taken by walking into the doorway**, with no separate "open
  the door" key. One fewer control, and it reads clearly on screen.
- **Support is tested at the spy's centre.** A spy whose middle is over a shaft
  is over the shaft. Per-corner support would let the player stand half on air.
- **Agents stay on their floor** — they do not ride elevators or fall, and they
  cannot touch or shoot a spy who is not on their floor — but they do walk
  across shaft openings. Giving them the shafts as well made them either
  harmless (stuck in one floor segment) or unfair; this is the middle course.
- **Elevators have call buttons**, which the arcade original does not. Without
  them a car can only be driven from inside, and two scripted playthroughs
  stranded themselves because of it. The button is the smallest fix that keeps
  the shafts as a one-way shortcut without making a run unwinnable.
- **No escalators, no shooting out the lights, no crouching.** The original's
  extra verbs are left out; walking, riding and shooting carry the game.
- **Three buildings is a complete run**, after which the game is won rather than
  looping forever.
- **The exit is shut until every document is collected**, so the lobby cannot be
  used as an early finish.
