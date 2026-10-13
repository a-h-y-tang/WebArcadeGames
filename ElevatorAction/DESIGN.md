# Elevator Action — Design

## Game concept

You are a spy who has been dropped onto the roof of an enemy ministry. The
building is a stack of floors joined by elevator shafts, and scattered along
those floors are **red doors** holding secret documents. Collect every document,
ride the elevators down to the lobby, and reach the getaway car parked at the
right-hand side of the ground floor.

The building fights back. Agents step out of the ordinary grey doors, walk toward
you and shoot. You can shoot them first — or, better, drop an elevator car on
their heads. You have three lives, and running out of them ends the run.

Four buildings make a full run. Each one is taller than the last, hides more
documents and releases agents faster.

## Playfield and geometry

| Constant | Value | Meaning |
|---|---|---|
| `W` × `H` | 640 × 600 | canvas (viewport) size in CSS pixels |
| `FLOOR_H` | 100 | vertical distance between floor surfaces |
| `PLINTH` | 14 | thickness of the slab a floor is drawn on |
| `PLAYER_W` × `PLAYER_H` | 16 × 34 | player bounding box |
| `ENEMY_W` × `ENEMY_H` | 16 × 32 | agent bounding box |
| `PLAYER_SPEED` | 150 px/s | walking speed |
| `ENEMY_SPEED` | 74 px/s | agent walking speed |
| `ELEV_SPEED` | 92 px/s | elevator car speed |
| `BULLET_SPEED` | 430 px/s | player bullet |
| `EBULLET_SPEED` | 300 px/s | agent bullet |
| `SHOT_COOLDOWN` | 0.22 s | minimum gap between player shots |
| `DOOR_W` | 38 | door width; `DOOR_REACH` 20 is the pickup radius |
| `SHAFT_W` | 56 | elevator shaft width |
| `RESPAWN_DELAY` | 1.3 s | pause between losing a life and restarting |
| `LEVEL_COUNT` | 4 | buildings in a full run |

The world is one canvas wide (no horizontal scrolling) and
`worldH = floorCount × FLOOR_H` tall. Floors are numbered from the bottom:
floor `0` is the lobby, floor `floorCount - 1` is the roof entrance where the
player starts. The walking surface of floor `i` is

```
floorSurfaceY(i) = worldH - i * FLOOR_H - PLINTH
```

so y grows downward, as canvas coordinates do, and higher floor numbers sit
higher on the screen. `floorAt(y)` is its inverse, rounding to the nearest floor
and returning `-1` for a y that is not within `FLOOR_SNAP` (6 px) of any floor.
A vertical camera follows the player (`camera.y`, clamped to
`[0, worldH - H]`), and everything is drawn in world coordinates offset by it.

## Layout generation

`buildLevel(n)` is pure and deterministic — the same `n` always produces the
same building. Randomness comes from a seeded `mulberry32` generator keyed on
the level number, so a test can rebuild a level and get an identical layout.

- **Floors**: `floorCount = 8 + (n - 1)`.
- **Shafts**: three, at x = 120, 300, 480. No shaft serves the whole building,
  so getting from the roof to the lobby means transferring between cars:
  shaft 0 serves `[mid, top]`, shaft 1 serves `[max(1, mid - 2), top - 1]` and
  shaft 2 serves `[0, mid + 1]`, where `top = floorCount - 1` and
  `mid = ⌊top / 2⌋`. Shafts 0 and 2 overlap at `mid`, which guarantees a route
  down; shaft 1 is a shortcut.
- **Doors**: four slots per floor, at x = 40, 210, 390, 560, chosen to miss
  every shaft. The lobby has only the two middle slots, keeping the escape
  corner clear.
- **Documents**: `3 + n` red doors, one per floor, on distinct floors drawn from
  `1 … top - 1` (the roof is a safe entry corridor and the lobby belongs to the
  getaway car). Every other door is grey: cosmetic, and a spawn point for
  agents.
- **Escape**: an `exitZone` on floor 0 spanning `x ∈ [W - 96, W - 24]`.

### Keeping the building solvable

A shaft that does not serve a floor is a wall on that floor, so a floor is a row
of walkable **segments** split by those walls. A shaft that *does* serve the
floor is both a gap between two segments and a lift to the other floors it
serves. `reachableRegions()` breadth-first searches that `(floor, segment)`
graph from where the player lands on the roof, and `buildLevel` places documents
only in regions it returns.

This is not a theoretical worry: the first generated layouts stranded documents
behind shafts that skipped a floor — on level 1, the slot at `x = 560` on floors
5 and 6, and `x = 40` on floors 1 and 2 — which made those buildings impossible
to finish. `tests/bot.spec.js` guards the same property from the other side by
actually playing each building to its end.

## Mechanics

### State machine

`state` is one of `idle`, `running`, `paused`, `dying`, `levelclear`,
`gameover`, `won`. `physicsStep(dt)` only simulates during `running` and counts
the respawn timer during `dying`; the animation loop calls it on a fixed
`1/120 s` timestep while `autoRun` is true. Tests set `autoRun = false` and call
`physicsStep` themselves, so every assertion is about a known number of steps
rather than wall-clock time.

### Walking, shafts and cars

The player's `y` is the position of their feet, and it is always either a floor
surface or the top surface of an elevator car (`player.onCar`). There is no
gravity — vertical movement happens only by riding a car.

A shaft is a hole in the floor, so it is **impassable unless a car is level with
the floor you are walking on**. `carLevelWith(shaft, floor)` is true when the
car's top surface is within `FLOOR_SNAP` of that floor's surface. Walking into a
shaft's interior with a car present puts the player on the car
(`player.onCar = shaft`); walking out again is allowed only while the car is
level with a floor, which is what makes a moving car feel like a cage.

`↑` / `↓` (or `W` / `S`) drive the car the player is standing on, and only while
held: the car moves at `ELEV_SPEED` and stops at the top and bottom surfaces of
the floors its shaft serves. The player's feet track the car every step, so
riding needs no extra bookkeeping.

A car nobody is standing on **answers the call of the floor the player is on**,
drifting toward it at the slower `ELEV_IDLE_SPEED` whenever its shaft serves
that floor. Without this the game deadlocks: cars can only be driven from the
inside, so a car parked one floor above you would be unreachable forever. It
also means waiting at a shaft is a real tactic, and that a car arriving from
above can flatten whatever is standing in the doorway.

A car travelling **down** crushes any agent whose body it reaches: if the car's
top surface lies between an agent's head and feet and their x ranges overlap,
the agent dies for `CRUSH_POINTS`. A car travelling up is harmless — walking
agents simply let it pass.

### Documents

Standing on a floor (not on a car) within `DOOR_REACH` of an untaken red door
collects its document automatically: no key press, no timing. The door turns
dark, `score` grows by `DOC_POINTS`, and `docsRemaining()` drops. Grey doors do
nothing when walked past.

### Agents

Agents walk toward the player's x while they are on the same floor and stop at
the edge of a shaft they cannot cross, exactly like the player. They never ride
elevators — a deliberate simplification, documented below. When on the player's
floor and facing them they fire on a `ENEMY_SHOT_CD` cooldown.

Spawning uses the level's seeded generator: every `spawnInterval` seconds (and
only while fewer than `MAX_ENEMIES` are alive) an agent steps out of a random
grey door on a floor within two of the player's. Agents whose floor scrolls far
off-camera are retired so the simulation stays bounded.

### Bullets, dying and scoring

Bullets are axis-aligned and travel horizontally at a fixed speed; they are
removed when they leave the canvas horizontally. A player bullet that overlaps
an agent kills it; an agent bullet that overlaps the player costs a life. Losing
a life clears all bullets and agents, enters `dying`, and after `RESPAWN_DELAY`
either puts the player back at the roof entrance (documents already collected
stay collected) or ends the run.

| Event | Points |
|---|---|
| Document collected | 500 |
| Agent shot | 300 |
| Agent crushed by a car | 800 |
| Building cleared | 1000 + 250 per life in hand |

Reaching the escape zone with documents still outstanding does nothing but
flash a reminder; with `docsRemaining() === 0` it ends the building. After the
last building the run is `won`. The best score is kept in
`localStorage['elevatoraction-best']`.

## Controls

| Input | Action |
|---|---|
| `←` `→` / `A` `D` | walk |
| `↑` `↓` / `W` `S` | drive the elevator you are standing on |
| `Space` | shoot (while playing), or start / dismiss an overlay |
| `P` | pause and unpause |

## Code layout

- `index.html` — page shell, HUD, canvas, overlay and help legend.
- `style.css` — dark ministry-at-night palette shared with the rest of the repo.
- `game.js` — everything else. State lives in top-level `let` bindings
  (`state`, `score`, `player`, `enemies`, `bullets`, `shafts`, `doors`,
  `camera`) because the Playwright suite drives the game through exactly those
  names; `physicsStep(dt)` is the single entry point to the simulation and
  `draw()` never mutates state.
- `tests/elevator-action.spec.js` — the rule-by-rule Playwright suite, written
  before the implementation. It loads `index.html` over a `file://` URL, freezes
  the loop with `autoRun = false`, and steps the simulation deterministically.
- `tests/bot.spec.js` — an autopilot that plans a route over the region graph
  and plays each of the four buildings to `levelclear` through the real key
  handling. It is the end-to-end answer to "can this actually be finished?".

### Test seams

Three globals exist so a test can pin down an exact situation, and all three
are left alone by normal play:

| Global | Effect |
|---|---|
| `autoRun` | `false` stops the animation loop from simulating, so a test owns the clock |
| `carHoming` | `false` freezes idle cars where they stand |
| `spawnEnabled` | `false` stops agents stepping out of doors |

## Assumptions

These are the judgement calls made where the brief or the original arcade game
left room; in each case the simpler reading won.

1. **No gravity for the player.** You cannot fall down a shaft or jump. Vertical
   movement is strictly by elevator, which removes a whole class of fiddly
   platforming states and makes the shaft rule above the only thing to learn.
2. **Shafts are impassable without a car.** The arcade original lets you walk
   over an open shaft; here an empty shaft blocks both the player and agents.
   This turns elevator positioning into the central puzzle.
3. **Cars move only while a key is held.** No "call the elevator to floor N"
   queueing — the car is a platform you drive directly.
4. **Agents do not use elevators.** They patrol the floor they spawned on. This
   keeps their AI a few lines long and keeps the whole simulation decidable in
   tests.
5. **Documents are collected by proximity**, not by a key press or a door-opening
   animation.
6. **Lives, not a timer.** The original's alarm/timer pressure is replaced by
   three lives and the agent spawn rate, which is enough tension without a
   second failure clock.
7. **Four buildings** make a full run, after which the game reports `won` rather
   than looping forever with scaling difficulty.
8. **One screen wide.** The building is exactly as wide as the canvas, so only
   the vertical camera moves.
9. **Deterministic levels.** Layout and agent spawning come from a seeded PRNG
   keyed on the level number rather than `Math.random`, so a replay (and a test)
   sees the same building twice.
10. **Idle cars come when called.** An unoccupied car drifts to the player's
    floor if its shaft serves it. The alternative — cars staying exactly where
    they were left — deadlocks a building the moment the player steps off one.
11. **Documents only where you can walk.** Rather than hand-tuning shaft ranges
    until every slot happens to be reachable, the generator computes
    reachability and places documents inside it.
12. **The repository's branch instruction wins.** The task asks for a branch
    named after the game, but this session is pinned to the designated branch
    `claude/compassionate-ramanujan-n1focc`, so the work is committed there.
