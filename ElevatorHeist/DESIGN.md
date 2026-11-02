# Elevator Heist — Design

## Concept

A spy has broken into a high-rise archive. Every floor holds a row of office
doors; some of them are **red** and hide a classified document. The spy has to
pull every document out of the red doors and then reach the **getaway car**
parked at the left edge of the ground floor — while building security agents
patrol the floors and shoot on sight.

The twist is that **you cannot walk between floors**. The only way down (or up)
is to ride one of the building's two elevator cars, and each car is wherever the
previous rider left it. Routing yourself through the shafts is the real puzzle;
shooting agents is the pressure that stops you from taking your time.

It is an original game in the spirit of vertical-building arcade games: nothing
else in this repo has moving-platform elevators, floor-locked movement or
door-looting.

## Mechanics

### Geometry

The building is a fixed pixel layout rather than a tile grid:

- Canvas is `720 x 520`. The building interior spans `x ∈ [24, 696]`.
- `FLOORS` horizontal floors, `FLOOR_H = 62` px apart, floor `0` at the top and
  floor `FLOORS - 1` on the ground. `floorY(i)` is the y of the walking surface.
- Two shafts (`SHAFTS`) at fixed x columns, each `SHAFT_W = 44` wide and
  spanning every floor. One car per shaft, `CAR_H = 14` thick, riding at
  `CAR_SPEED` px/s.
- Each floor carries up to `DOORS_PER_FLOOR` doors in evenly spaced slots that
  never overlap a shaft. A door is either `red` (holds a document) or `blue`
  (scenery, and the spawn point for agents).

### The spy

- Runs left/right at `PLAYER_SPEED`, clamped to the building interior.
- Is always *on* a floor (`player.floor`) or *riding* a car
  (`player.riding` = shaft index). There is no gravity and no jumping: movement
  is locked to the floor the spy is standing on.
- **Ducks** with `Down` when standing on a floor. A ducking spy is 16 px tall
  instead of 34, which is short enough for agent bullets (fired at chest height)
  to pass overhead. Ducking also stops horizontal movement.
- **Shoots** with `Space`/`Z`, one bullet at a time per press, travelling in the
  spy's facing direction at chest height. Bullets kill agents and are consumed.

### Elevators

- Pressing `Up`/`Down` while standing on a floor inside a shaft whose car is
  level with that floor **boards** the car.
- While riding, `Up`/`Down` drive the car; the car stops at the top and bottom
  of the shaft. The spy's y follows the car's y continuously, so a ride is not
  snapped to floors.
- Pressing `Left`/`Right` while riding, with the car level with a floor, steps
  the spy off onto that floor in that direction.
- A car that reaches a floor where an agent is standing inside the shaft
  **crushes** the agent (worth points) — the only way to clear an agent without
  a bullet.

### Agents

- Spawn from blue doors on floors at or below the spy's floor, up to
  `maxAgents` for the level, on a timer that shortens as levels advance.
- Walk toward the spy's current x while on the same floor, otherwise patrol
  their own floor. Agents never use the elevators (deliberately simple — it
  keeps them a floor-local threat you can escape by riding away).
- Fire a bullet at chest height on a cooldown when roughly facing the spy on the
  same floor. An agent bullet that hits a standing spy costs a life.

### Doors and scoring

- Walking onto a red door and pressing `Up` opens it and takes the document:
  `+250` and the door turns gray. `Up` is interpreted as "open door" only when
  the spy is not inside a boardable shaft, and doors are never generated inside
  a shaft, so the two uses of `Up` can never collide.
- Opening a blue door does nothing except flash it.
- Shooting an agent is `+100`; crushing one with a car is `+150`.
- When every document on the level is taken, the getaway car at the left end of
  the ground floor lights up. Reaching it clears the level: `+500` plus
  `+100 × floors` bonus, then the next level is generated.

### Levels

Levels are generated from a seeded PRNG (`mulberry32(level * 2654435761)`), so
level *n* is always the same building — tests and players get identical layouts.
Level progression: floors grow `6 → 9`, documents grow `3 → 6`, agent cap grows
`2 → 5`, agent speed and fire rate scale mildly.

### Lives / game over

Three lives. Losing one resets the spy to the level's start position (top floor)
and clears agents and bullets, but **keeps** the documents already collected.
At zero lives the game ends and the best score is written to
`localStorage['elevatorheist-best']`.

## Controls

| Key | Action |
|---|---|
| `←` `→` | run / step off a car |
| `↑` | board or raise a car, open the door you are standing on |
| `↓` | board or lower a car, duck when on a floor |
| `Space` / `Z` | fire |
| `P` | pause |
| `Space` (idle / game over) | start a new game |

## Code shape

`game.js` is a single classic (non-module) script, matching Gold Runner,
BurgerTime and the rest of the repo: all state and helpers are plain globals so
the Playwright specs can poke at them directly. Simulation is per-second and
advanced only through `step(dt)`; `requestAnimationFrame` just calls
`step(dt)` + `draw()`. Tests set `autoStep = false` to take time under their own
control, which makes every spec deterministic.

Key globals the tests use: `state`, `player`, `cars`, `agents`, `bullets`,
`doors`, `level`, `lives`, `score`, `docsTaken`, `docsNeeded`, `keys`,
`startGame()`, `step(dt)`, `floorY(i)`, `LEVELS`-equivalents
(`FLOORS`, `SHAFTS`, `levelSpec(n)`).

## Assumptions

Decisions taken without asking, erring toward the simpler reading:

1. **Agents stay on their floor.** Giving security its own elevator AI would
   make the chase far harder to reason about (and to test). Riding away from a
   floor is therefore always an escape.
2. **Escalators are not modelled.** Only elevators move the spy vertically.
3. **One bullet per key press, one spy bullet in flight.** Keeps shooting a
   timing decision rather than a spray.
4. **`Up` is overloaded** (board car / open door). Doors are never placed inside
   a shaft, so the context is always unambiguous.
5. **Ducking stops horizontal motion.** A crouch-walk would need a second
   animation state for no mechanical gain.
6. **Dying keeps collected documents.** Losing them would make late-level deaths
   effectively a game over.
7. **Procedural levels, seeded per level number.** Hand-authored layouts were
   the alternative; a seeded generator gives unlimited levels and still gives
   tests a fixed, assertable building.
8. **No sound.** Consistent with the other games in this repo.
9. **Branch naming.** The task asked for a branch named after the game, while
   this session's standing instructions pin pushes to
   `claude/compassionate-ramanujan-6jcnlk`. Local development is on
   `elevator-heist`; it is pushed to the designated remote branch so both hold.
