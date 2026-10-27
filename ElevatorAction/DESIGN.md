# Elevator Action — Design

How the code works, floor by floor. For the player-facing rules see
[README.md](README.md).

## Concept

A spy drops onto the roof of a seven-storey building. Red doors hide secret
documents; grey doors hide enemy agents. Ride the two elevators down, collect
every red-door document, then reach the getaway car in the basement garage
before the agents shoot you. Three lives, then the game is over.

The whole building fits on one 640x600 canvas — there is no camera and no
scrolling, so every floor, both shafts and the garage are visible at once.

## Mechanics

| Element | Rule |
|---|---|
| Floors | 7 surfaces (`floorY(0)` = roof floor … `floorY(6)` = garage). Each is solid except where a shaft cuts through it. |
| Shafts | 2 shafts, 64px wide. A floor's walkway is broken at each shaft; you can only cross if that shaft's car is level with the floor. |
| Elevators | One car per shaft. Standing on a car, Up/Down drives it between the top and bottom floor. The car carries you with it. |
| Doors | 3 doors per office floor (floors 0–5), 18 in all. Red doors hold a document; grey doors are agent spawn points. |
| Documents | Walking into a red door opens it and banks the document (+500). The getaway car stays dark until all of them are in hand. |
| Agents | Walk their floor, turning at walls and shaft edges. They fire along the floor when you share it and are in front of them. |
| Ducking | Down on a *floor* ducks (height 30 → 16). Bullets fly 20px above the floor, so a ducked spy is missed and a standing one is hit. |
| Shooting | Space fires in the facing direction, up to 3 player bullets alive at once. An agent hit is worth 200. |
| Escape | Overlap the getaway car on floor 6 with every document collected → level clear, +1000 and +100 per level. |
| Death | Any bullet hit costs a life. After a short pause the spy respawns on the roof; collected documents are kept, agents and bullets are cleared, and both cars return to the roof so a car stopped mid-shaft cannot strand the spy. |

Later levels raise the agent cap (`3 + level`, capped at 6), their speed and
their rate of fire, and ask for one more document (`3 + level`, capped at 6).

## Controls

| Key | Action |
|---|---|
| `←` `→` / `A` `D` | Walk |
| `↑` `↓` / `W` `S` | Drive the elevator you are standing on |
| `↓` / `S` | Duck (when standing on a floor) |
| `Space` | Shoot / start / advance past an overlay |
| `P` | Pause |

## Code structure

```
index.html   HUD, canvas, overlay, help text
style.css    the shared arcade shell used across this repo
game.js      constants, state, simulation, rendering, input
```

`game.js` keeps its state in top-level `let`/`const` bindings on purpose —
`state`, `score`, `lives`, `level`, `player`, `elevators`, `doors`, `enemies`,
`bullets` — because the Playwright suite drives the game through exactly those
names. The same goes for the functions it calls: `startGame()`,
`physicsStep(dt)`, `shoot()`, `placePlayerOnFloor()`, `spawnEnemyAt()`,
`docsLeft()` and `togglePause()`.

### Fixed timestep

Every rule lives in `physicsStep(dt)` and the animation loop only feeds it
`DT = 1/120` slices. Tests set `autoRun = false`, which stops the loop from
simulating, and then call `physicsStep(DT)` themselves — so a test advances the
world exactly as far as it wants and never races a frame.

### Support model

The spy is always standing on something, tracked as
`player.support = { type: 'floor', index } | { type: 'elevator', id }`. That one
field drives the three interesting cases:

* **Walking off a floor into a shaft** is refused unless that shaft's car is
  within `ALIGN_EPS` of the floor; if it is, support switches to the car.
* **Walking off a car** is refused unless the car is level with a floor; if it
  is, support switches to that floor.
* **Driving a car** only responds to Up/Down while support is that car, and the
  car's `y` is written straight onto `player.y` so the ride is exact.

There is therefore no gravity and no falling: the spy cannot be anywhere other
than on a floor or on a car.

### Determinism

Agent spawns pick a grey door through `rng()`, a seeded mulberry32 reseeded by
`startGame()`. Door layout and which doors are red are pure functions of the
level, not of the RNG, so level 1 is the same building every time.

## Assumptions

Ambiguities were resolved toward the simpler reading, and the choices made are:

1. **Branch name.** The task asked for a branch named after the game
   (`elevator-action`), but this session is required to develop and push on its
   assigned branch `claude/compassionate-ramanujan-1jnyby`. The assigned branch
   wins; no second branch was created.
2. **No scrolling.** The real arcade game scrolls a tall building. Here the
   building is sized to fit the canvas, which removes a camera and makes every
   floor testable by coordinate.
3. **Shafts are walls, not pits.** Stepping into an empty shaft is refused
   rather than fatal. Falling down a shaft would need gravity and a second
   death cause for no extra depth.
4. **No escalators.** The arcade game mixes escalators with elevators; only
   elevators are modelled.
5. **Agents do not ride elevators or duck.** They patrol one floor and shoot
   along it. Cross-floor pursuit would need a path-finder and would not change
   how the game plays on any one floor.
6. **Contact is harmless.** Only bullets kill, so a spy and an agent can pass
   through each other. This keeps a single, legible death cause.
7. **No crushing, no shooting out the lights.** The arcade game lets you crush
   agents with a car and darken a floor; both are dropped as flourishes that do
   not carry the core loop.
8. **Doors are collected on overlap.** Walking into a red door takes the
   document immediately rather than requiring a separate "enter" press.
