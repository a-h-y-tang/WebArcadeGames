# Elevator Action — Design

How the code works, the rules it implements, and the assumptions behind them.

## Game concept

You are a spy dropped onto the roof of a six-storey building. Every floor has
doors; the **red** ones hide secret documents. Grab every document, then ride
the elevators down to the lit **EXIT** on the ground floor. Enemy agents step
out of the **blue** doors and shoot on sight, so the descent is a running fight
down the shafts.

Five buildings (levels) make a full run. Each one spawns agents faster and
moves them quicker than the last.

## Mechanics

### The building

The playfield is a fixed 480×640 canvas. Six floor surfaces sit at
`floorY(i) = FLOOR_TOP + i * FLOOR_H` (108, 200, 292, 384, 476, 568), between
side walls at `WALL_L = 28` and `WALL_R = 452`. Nothing is randomised: a level
number fully determines its layout, so every run of level 3 is the same
building. That also makes the whole simulation testable without stubbing a
random source.

### Elevators

Two shafts cut through every floor, centred at x = 150 and x = 330, each
`SHAFT_W = 54` wide. Each shaft holds one car. A floor is solid everywhere
except where a shaft crosses it:

- Walking into a shaft whose car is **not** level with your floor is blocked —
  you stop at the shaft edge rather than falling down the hole.
- When the car **is** level with the floor, you walk straight in and are now
  riding it (`player.inCar` is the shaft index).
- While riding, `↑`/`↓` drive the car between the top and bottom floors at
  `ELEVATOR_SPEED` px/s — about a floor a second. The car carries you with it.
- Let go of both and the car settles onto the nearest floor at the same speed.
  Stopping at a landing is therefore a matter of timing rather than pixel
  accuracy, and a car can never be abandoned halfway up a shaft.
- Walking left or right while the car is level with a floor steps you back out
  onto that floor.

Because the car is the only way between floors, route planning — not jumping —
is the movement puzzle.

### Documents and the exit

A red door is collected by simply walking onto it (`DOC_POINTS` each). The HUD
`Docs` counter shows how many are left. The exit on the ground floor only opens
once that counter hits zero; stepping into it with documents still outstanding
does nothing. Clearing a building pays `CLEAR_BONUS` plus `LIFE_BONUS` per life
still in hand.

### Agents, shooting and crouching

Enemy agents spawn from blue doors on a timer (`spawnInterval`, tightened each
level) up to a per-level cap. They patrol their own floor, turning at walls and
at shaft edges, and fire a horizontal shot every `ENEMY_FIRE_INTERVAL` seconds
when you are on their floor and in front of them.

Shots carry a height. Enemy fire is always **high**:

- Standing, your body spans 34 px above the floor, so a high shot hits you.
- Crouched (`↓` while not in a car), you span 20 px and the shot passes over.

Your own shot is **low** when fired crouched and **high** otherwise; agents
stand full height, so either one kills them (`ENEMY_POINTS`). Shots only
interact with bodies on the same floor, so a bullet never hits someone a storey
away even though their screen positions can overlap.

Taking a hit — bullet or body contact — costs a life and respawns you at the
top floor with `INVULN_TIME` seconds of immunity and the bullets cleared. Three
lives; losing the last one ends the run. The best score is kept in
`localStorage` under `elevatoraction-best`.

## Controls

| Input | Action |
|---|---|
| `←` `→` / `A` `D` | walk; step out of a car that is level with a floor |
| `↑` `↓` / `W` `S` | drive the car you are riding up or down |
| `↓` / `S` (on a floor) | crouch — ducks high shots, and fires low |
| `Space` | start, fire, or dismiss an overlay |
| `P` | pause / unpause |

## Code structure

- `index.html` — page shell, HUD, canvas, overlay, key legend.
- `style.css` — cabinet styling shared in spirit with the other games here.
- `game.js` — the whole game: layout, simulation, rendering, input.
- `tests/elevator-action.spec.js` — Playwright suite driving the module below.

`game.js` keeps its state in top-level `let` bindings (`state`, `score`,
`level`, `lives`, `player`, `elevators`, `doors`, `enemies`, `bullets`,
`autoRun`) and its behaviour in top-level functions (`startGame`,
`physicsStep`, `buildLevel`, `fire`, `loseLife`, `docsRemaining`, `atExit`,
`floorY`, `advance`, `draw`, `updateHud`). That is deliberate: the Playwright
suite reaches those exact names through `page.evaluate`, sets up an exact
situation, and advances the simulation one fixed step at a time.

The animation loop accumulates real time and calls `physicsStep(DT)` with
`DT = 1/120` as many times as fit, so behaviour does not depend on frame rate.
Setting `autoRun = false` freezes the loop's simulation while rendering
continues — every test drives the clock itself from there.

## Assumptions

Where the brief left room, the simpler reading won. Each of these is a decision
rather than a rule handed down:

- **Branch name.** The task asked for a branch named after the game
  (`elevator-action`), but this session is pinned to the branch
  `claude/compassionate-ramanujan-qxx8uc` and told never to push elsewhere. The
  session's branch wins; the kebab-case name lives on as the folder and spec
  name.
- **No falling.** There is no gravity or jumping. A shaft without its car is a
  wall, not a hole. This keeps movement a routing problem and the simulation
  exactly reproducible.
- **Documents collect on contact** rather than on a separate "open the door"
  key press — one less key for the same decision.
- **Boarding is sticky.** The key that walks you into a car is locked out
  until it is released, otherwise holding a direction would board the car and
  step straight out the far side — walking through a shaft that is supposed to
  be a hole in the floor. `player.carLock` carries that one-shot state.
- **A car between floors is a safe pocket.** `floorAt` only reports a floor
  when the car is exactly level with one, so a rider mid-shaft is on floor
  `-1`: nothing can shoot them, and their own shots hit nothing either.
- **Crouching roots you.** A crouched player does not walk. One posture, one
  purpose: duck a shot and fire low.
- **A shaft is not cover.** Shots cross a shaft opening rather than stopping at
  it, so standing in a car level with a floor is still dangerous.
- **Agents stay on their floor.** They do not call or ride elevators. A car is
  always yours, so a descent is never softlocked by an agent parking one
  elsewhere.
- **Agents are always standing**, so crouching is purely the player's trick:
  it dodges fire and still lets you shoot back.
- **Doors are decoration plus a trigger.** Nobody walks *into* a door; a red
  door is a pickup and a blue door is a spawn point.
- **Deterministic layouts and spawn order.** Door kinds come from an index
  formula and spawns walk the enemy doors round-robin, so no RNG appears
  anywhere in the game.
- **Five levels, then a win.** Rather than looping forever, finishing level 5
  reaches a `won` state, matching how the other finite games in this repo end.
