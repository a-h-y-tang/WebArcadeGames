# Elevator Action — Design

## Concept

You are a spy dropped onto the roof of a six-storey enemy building. Every floor is
a sealed corridor cut into segments by two elevator shafts, and the only way from
one segment to another is to ride an elevator car. Scattered through the building
are **red doors** holding secret documents. Grab every document, then ride down to
the ground floor and slip out through the escape door on the far left — while
enemy agents patrol the corridors and shoot on sight.

The game is one self-contained HTML5 canvas page (`index.html` + `style.css` +
`game.js`) with no build step, matching the rest of this repo.

## Layout and geometry

The canvas is 720x480. Six floors are stacked 70px apart, the top floor's walking
surface at y = 50 and the ground floor at y = 400. The escape door stands in the
ground floor's left corner (x <= 70); the strip beneath it is the lobby, drawn as
scenery so the building has a base.

```
floorY(f) = 50 + f * 70          f = 0 (roof) .. 5 (ground)
```

Two elevator shafts are cut through every floor at x = 250 and x = 470, each 56px
wide. A shaft therefore splits each floor into three walkable segments:

```
[20 .. 222]   shaft 1   [278 .. 442]   shaft 2   [498 .. 700]
```

Each shaft holds exactly one car. A car's `y` is the surface the rider stands on;
it slides between the roof floor and the ground floor at 70 px/s.

## Mechanics

**Walking.** The player walks left and right at 120 px/s and is clamped by the
outer walls. A shaft opening is *solid* unless that shaft's car is level with the
floor the player is standing on — you cannot cross a shaft, and you cannot fall
down one either (see Assumptions).

**Riding.** Walking into a shaft whose car is level with your floor boards the
car: the player snaps to the shaft centre and `player.ride` becomes the shaft
index. Boarding latches the direction key that carried you in, so you do not
immediately walk straight back out again.

A car travels one floor per press: Up or Down sets `car.target` to the adjacent
floor and the car slides there at 70 px/s, arriving exactly on the floor's y so
alignment can be tested with plain equality (`carFloor`). A car in transit
ignores further input, which is why `step` updates the player *before* the
elevators — a press taken this frame drives the car this frame.

Left/Right step off to that side, but only while the car is level with a floor.
A rider between floors has `player.floor === -1` and is untouchable — bullets
and agents only interact with entities that share a floor index.

**Respawning recalls the roof car.** Cars only move when someone is riding them,
so a death while both cars were parked low would strand the spy in a sealed
roof segment with no way to call one back. `resetPlayer` therefore returns the
first car to the roof along with the spy.

**Documents.** Red doors hold documents. Walking over a red door collects it
(+100), the door turns grey, and the HUD's `Docs` counter advances. Plain grey
doors are scenery — and the hatches new agents step out of.

**Shooting.** Space fires in the direction the player faces (0.25s cooldown).
Bullets travel along their floor at 330 px/s (player) or 260 px/s (agent) and are
removed at the walls. A player bullet that reaches an agent on the same floor
kills it (+200); an agent bullet that reaches the player costs a life.

**Agents.** Agents never ride, so a shaft is a wall to them whether or not a car
is there: they patrol their own floor and their own segment, reversing at the
walls and at both shaft openings. When the player is on their floor they turn to
face them, close in — holding position at a shaft edge rather than bouncing off
it — and fire on a cooldown. Because bullets cross shafts, an agent can shoot
across one it cannot walk through. Touching an agent also costs a life. Fresh agents step out of
grey doors every few seconds, up to a per-level cap; agent speed, fire rate and
cap all scale with the level.

**Losing a life** resets the player to the roof spawn, clears every bullet and
grants 1.5s of invulnerability. Collected documents are kept. At zero lives the
run ends and the best score is written to `localStorage` under
`elevatoraction-best`.

**Finishing a level** requires all documents collected *and* the player standing
in the escape zone (ground floor, x <= 70). That scores 1000 and loads the next
layout; layouts cycle through three hand-authored floor plans while the
difficulty keeps climbing.

## Controls

| Key | Action |
|---|---|
| Left / Right (or A / D) | Walk, or step off an elevator |
| Up / Down (or W / S) | Send the elevator you are riding one floor |
| Space | Start the game; fire once playing |
| P | Pause / resume |

## Code structure

`game.js` is a single classic (non-module) script, so every piece of state is a
plain global reachable from Playwright — the same pattern Gold Runner, BurgerTime
and Snake use in this repo. All motion is per-second and applied by `step(dt)`,
and `autoStep` can be switched off so a test drives the simulation frame by frame
instead of racing `requestAnimationFrame`. Randomness (agent respawn doors and
timing) goes through a small seeded LCG (`rand()`, seeded by `setSeed()`), so a
test can pin the seed and get identical runs.

Update order inside `step(dt)`: player input, elevators, position sync, bullets,
agents, contact, documents, agent spawns, escape check, HUD.

## Assumptions

These were judgement calls made while building the game autonomously; each takes
the simpler reading.

- **Shafts are solid when empty.** The arcade original lets you fall down an open
  shaft. Modelling a fall means a second physics mode for one rare event, so an
  empty shaft simply blocks movement instead. It keeps every rule decidable on
  whole floors and keeps the "the elevator is the only way around" pressure.
- **Riders are locked to the shaft centre.** You cannot walk along an elevator
  car; boarding snaps you to the middle of the shaft.
- **A car travels one floor per press.** Holding Up or Down does not run an
  express to the top or bottom: each press books a single floor, and the car
  ignores input until it arrives. Stopping exactly on a floor keeps alignment a
  plain equality test rather than a tolerance, which keeps every floor-based
  rule decidable.
- **Space both starts and shoots.** Space starts the game from the idle and
  game-over states and fires while playing, so the game needs no extra fire key.
- **Bullets ignore shafts.** A bullet crosses a shaft opening whether or not a car
  is there; only walls stop it.
- **No door-crushing or kick attacks.** The original's elevator-crush kill and the
  jump-kick are left out; shooting is the only attack.
- **Fixed layouts, scaling difficulty.** Three hand-authored floor plans cycle
  rather than generating levels procedurally; the level number drives agent speed,
  fire rate and population instead.
- **Branch naming.** The task asked for a branch named after the game
  (`elevator-action`), but this session is pinned to the designated branch
  `claude/compassionate-ramanujan-rk0jw7`, which takes precedence; the work lives
  there.
