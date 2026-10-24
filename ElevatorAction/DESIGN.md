# Elevator Action — Design

## Concept

A spy drops into the top floor of a ten-storey building, raids every red door
for its secret documents, and rides elevators and stairwells down to the
basement where a getaway car is waiting. Enemy agents step out of the ordinary
doors and shoot on sight, so the descent is a running gunfight.

The game is a single HTML5 canvas (640x480) with a vertically scrolling camera
over a 760px-tall building. Everything is drawn procedurally — no images, no
audio, no build step. Open `index.html` and play.

## Building model

| Thing | Value |
|---|---|
| Floors | 10 (`FLOORS`), index 0 = top floor, index 9 = basement |
| Floor strip height | 76px (`FLOOR_H`) |
| Feet level of floor `i` | `floorY(i) === (i + 1) * FLOOR_H` |
| Building height | 760px (`BUILDING_H`) |
| Elevator shafts | 2, spanning every floor |
| Red doors (documents) | 5 (`DOC_TOTAL`) |
| Lives | 3 (`LIVES_START`) |

Floors are labelled the way a lift panel would label them: floor index 0 is
"9", index 8 is "1", and index 9 is "B".

Each floor is a strip with a solid slab at its bottom; the player's `y` is
always the feet position in world coordinates, so "standing on floor `i`"
means `player.y === floorY(i)`.

### Layout generation

The layout is produced by a seeded PRNG (`mulberry32`) keyed off the level
number, so a given level always builds the same building — which is what makes
the Playwright suite able to assert about doors, stairs and reachability.

* **Doors** sit in fixed slots on every floor except the basement. Five of
  them (chosen by the PRNG, never on the basement, never two on the same slot)
  are red and hold a document; the rest are plain and are where agents come
  from.
* **Stairwells** are vertical runs between adjacent floors. Generation
  guarantees at least one stairwell for every adjacent pair, so the building is
  always walkable from roof to basement even if both elevators are parked
  somewhere awkward.
* **Elevators** are one car per shaft. A car is only ever moved by a player
  riding it; parked cars stay put.

## Mechanics

**Walking.** Left/Right walk along the current floor at `WALK_SPEED`. Walls
clamp movement. A shaft opening is a wall too *unless* a car's roof is level
with that floor (within `SNAP`), in which case the player can walk on to the
car.

**Elevators.** While riding (`player.mode === 'elevator'`), Up/Down drive the
car at `CAR_SPEED` and the player rides along. Cars clamp to the top and
bottom feet levels of the building. Walking off the side of a car is only
allowed when the car is level with a floor; otherwise the player is clamped to
the car's width. A car that *is* level with a floor doubles as a bridge, so
walking straight on and off the far side crosses the shaft.

**Calling a car.** Standing within `CALL_DX` of a shaft doorway and holding the
call key (E, or Enter) drives the nearest car in that shaft toward your floor,
stopping level with it. The call plates beside each doorway light up when you
are close enough to use them. The key is deliberately *not* Up or Down: a
stairwell slot can sit entirely inside a doorway's call range, and sharing the
key left only a few pixels of floor where a car could be called at all — found
by a scripted bot playthrough that soft-locked on floor 8 for exactly that
reason.

**Stairwells.** Pressing Down while standing at a stairwell's top, or Up while
standing at its bottom, puts the player in `'ladder'` mode; they then climb at
`CLIMB_SPEED` until they reach either end, which drops them back into
`'floor'` mode on that floor.

**Documents.** Walking into a red door opens it and banks `DOC_POINTS`. A door
only pays once. The HUD tracks `docs / DOC_TOTAL`.

**Shooting.** Space fires a bullet in the direction the player faces, with a
fixed cooldown so the key cannot be spammed. Bullets fly at torso height
(`feet - 24`). A player bullet kills an agent for `ENEMY_POINTS`.

**Crouching.** Down on a floor (when not at a stairwell) crouches. A crouched
player is 18px tall, which is *below* torso height, so enemy fire passes
harmlessly overhead. Crouching is the main defensive move.

**Agents.** Agents spawn from plain doors on the player's floor or an adjacent
one, never closer than `SPAWN_MIN_DX` to the player, capped at
`MAX_ENEMIES`. They walk toward the player and shoot when on the same floor.
Touching one, or being shot, costs a life. After losing a life the player gets
`INVULN_TIME` seconds of immunity and the floor is cleared of agents and
bullets.

**Winning.** With all five documents collected, reach the basement and walk to
the getaway car (`player.x <= ESCAPE_X`): that ends the run with
`ESCAPE_BONUS` plus `LIFE_BONUS` for each life still in hand. Reaching the car
without the full set does nothing.

**Losing.** Running out of lives ends the game; the best score is persisted to
`localStorage` under `elevatoraction-best`.

## Controls

| Key | Action |
|---|---|
| &larr; &rarr; / A D | Walk |
| &uarr; &darr; / W S | Ride elevator, climb stairs |
| &darr; / S | Crouch (on a floor, away from stairs) |
| Space | Shoot |
| E / Enter | Call a car to your floor (standing by a shaft) |
| P | Pause |
| Space / Start button | Start, or restart after a game over |

Key priority when Down is pressed: ride an elevator, else enter a stairwell,
else crouch. Calling runs on its own key, so it never competes with any of
those.

## Code shape

`game.js` is one file of top-level state and plain functions, matching the
convention used by the other games in this repo:

* `physicsStep(dt)` is the whole simulation, run on a fixed `DT = 1/120`
  timestep from the `requestAnimationFrame` loop.
* `autoRun` gates the loop. The Playwright suite sets `autoRun = false` and
  calls `physicsStep()` itself, so every assertion runs against an exactly
  known number of simulation steps rather than wall-clock timing.
* State the tests drive (`state`, `score`, `lives`, `docsCollected`, `player`,
  `enemies`, `bullets`, `cars`, `doors`, `stairs`) is intentionally top-level.
* `draw()` is pure rendering and never mutates simulation state.

## Assumptions

These are the judgement calls made where the brief or the arcade original left
room, resolved toward the simpler reading:

1. **Branch name.** The brief asks for a branch named after the game
   (`elevator-action`), but this session is pinned to the branch
   `claude/compassionate-ramanujan-z8w5u5` and is told never to push
   elsewhere. The pinned branch wins; the game folder carries the name.
2. **Escalators are stairwells.** The original's moving escalators are modelled
   as climbable stairwells. Same topology, far less state.
3. **Elevators are player-driven only.** Cars never move on their own. This
   removes a whole class of timing races and makes the descent a planning
   problem instead of a waiting one.
4. **No shaft falls.** A shaft opening with no car behind it is solid. The
   original lets you fall to your death; blocking it keeps the player from
   losing lives to a camera they cannot see past.
5. **No shootable lights.** The original's "shoot the lights to darken the
   floor" mechanic is omitted; it is pure flavour and would need a lighting
   pass.
6. **No elevator crushing.** Agents cannot be squashed by a car.
7. **Respawn in place.** Losing a life respawns the player on the current floor
   with brief invulnerability rather than restarting from the roof, and
   collected documents are kept. Losing progress on a 10-floor descent felt
   punishing out of proportion.
8. **Agents do not crouch**, so every player bullet that lines up connects.
   They also ignore shaft openings when they walk, where the player does not:
   agents patrol the full width of their floor.
9. **One building, repeatable.** Finishing the building wins the run outright
   rather than generating a harder second building; `level` exists in the code
   and seeds layout generation, but a single escape ends the game.
