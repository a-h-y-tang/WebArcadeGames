# Elevator Heist — Design

## Concept

A six-storey corporate tower has been locked down and the intelligence it holds
is about to be shredded. You are the agent sent in through the roof. Walk the
floors, ride the two elevator cars between them, kick open office doors to find
the three secret documents hidden in the building, then escape through the exit
on the ground floor — all while the building's security agents hunt you down.

The twist that makes the game its own thing is that the elevators are the only
way between floors, and they are also the only safe place in the building: while
a car is *between* floors nobody has a clean line of fire at you. Every descent
is a decision about which car to take, how long to hide in the shaft, and which
floor to step out onto.

It is an original game built on the vertical-building idea rather than a port of
any particular existing title, and no other game in this repo uses floor/shaft
traversal as its core movement.

## Mechanics

### The building

- Six floors. Floor `0` is the roof level (where you start), floor `5` is the
  ground floor (where the exit is).
- Floor surfaces are 96px apart; the walkable span is `x` 28–692.
- Two elevator shafts at `x` 180 and `x` 420, each 56px wide, with one car per
  shaft. Cars travel the full height of the building at 90 px/s.
- Six office doors are spread over floors 0–4 (never the ground floor, which is
  kept clear for the escape). Three of the six hide a document.

### Core loop

1. **Walk** a floor left/right at 160 px/s.
2. **Ride** a car: press up in a shaft doorway. If the car is there you board
   it; if it is elsewhere you call it and it comes to you (without this, a
   player on a floor both cars had left would be stranded for good). Hold
   up/down to drive it, and let go to have it settle at the nearest floor. Step
   out sideways only when the car is level with a floor.
3. **Raid** a door: stand in front of it and press up. A document door scores 200
   and counts toward the three you need. An empty door is a trap — a security
   agent steps out of it.
4. **Escape**: with all three documents, reach the exit on the ground floor. That
   scores 500 and promotes you to the next, harder level (more agents, faster).

### Threats

- Security agents patrol a floor, turn around at the walls, and turn to face you
  the moment you share their floor. Spotting you is not the same as having you
  in their sights: an agent needs 0.5s to aim after acquiring you, which is the
  window you get to shoot first or step back into a car. After that they fire
  roughly every 1.4s while facing you on your floor, and touching one costs a
  life.
- Agents cannot see, shoot or touch a player who is inside a car — the shaft is
  the game's safe room. The player cannot fire out of one either, so every
  moment of safety is a moment of lost firepower.
- You fire back along your facing direction: 420 px/s bullets, at most three in
  the air, 0.3s between shots, 150 points per agent.
- Losing a life clears all bullets, returns you to the roof with 1.5s of
  invulnerability, and costs you nothing else. Three lives; zero ends the run.

### Difficulty curve

Each level adds an agent (capped at six) and 6 px/s to agent walking speed. The
door layout and agent placement are regenerated from a level-seeded PRNG, so a
given level always looks the same but successive levels differ.

## Controls

| Input | Action |
|---|---|
| `←` `→` / `A` `D` | Walk; while in a shaft, step out to that side (only when level with a floor) |
| `↑` `↓` / `W` `S` | Drive the car you are standing in |
| `↑` / `W` (press) | Step into a car that is level with you, or open the door in front of you |
| `Space` | Fire |
| `P` | Pause / resume |
| `Space` / `Start` button | Begin a run, or restart after game over |

## Code shape

`game.js` is a single classic script (no modules, no build step) holding three
layers:

- **State**: top-level `state`, `player`, `elevators`, `doors`, `agents`,
  `bullets`, `score`, `lives`, `level`, `docsCollected`. A classic script's
  top-level bindings are reachable from Playwright's `page.evaluate`, which is
  what the test suite drives.
- **Simulation**: `physicsStep(dt)` is the only thing that advances the world,
  and it is pure with respect to time — it takes `dt` and touches nothing else.
  `tick(dt)` is the gate in front of it that honours pause/game-over, and the
  `requestAnimationFrame` loop (guarded by `autoRun`) is the only caller of
  `tick`. Tests set `autoRun = false` and call `physicsStep` themselves, so every
  test is deterministic and frame-rate independent.
- **Input/render**: `keys` holds held state; `pressVertical(dir)`,
  `pressHorizontal(dir)` and `firePlayerBullet()` are the edge-triggered actions
  that keyboard handlers and tests both call.

## Assumptions

Decisions made without a human to ask, each resolved toward the simpler reading:

- **Branching.** The task asked for a branch named after the game, while this
  session's standing instruction names `claude/compassionate-ramanujan-3ot76f` as
  the branch to push. Both are honoured: development happens on the local
  `elevator-heist` branch, and that work is published on the designated branch.
- **No gravity.** The player never falls. Vertical movement happens only inside a
  car, so the floors need no jumping, ledges or fall damage. Walking "over" a
  shaft is allowed: the shaft is drawn behind the walkway rather than as a hole.
- **No crushing.** A car cannot hurt anybody; riding is purely transport. The
  classic "crushed by the elevator" hazard was dropped as it adds a failure mode
  that is hard to read on a flat canvas.
- **Doors never overlap shafts**, so pressing up is never ambiguous: if a car is
  level with you, up boards it; otherwise up opens a door you are in front of.
- **Three documents, six doors, fixed slots.** A seeded PRNG picks the layout, so
  levels are reproducible for both players and tests, and the suite asserts
  layout invariants (counts, floor ranges, shaft clearance) rather than exact
  coordinates.
- **Agents are grounded.** They never ride elevators or change floors; a floor you
  have cleared stays clear until an empty door spawns a new one.
- **Cars answer a call button but never move on their own.** An idle car with no
  call stays put, so the building state is always something the player chose.
- **Balance was measured, not guessed.** A scripted bot that walks, calls cars,
  loots and shoots plays the game headlessly: it clears level 1 with a life to
  spare and dies on level 2 by walking into an agent, which is the curve this
  game is aiming for. The call button and the aim delay both came out of that
  play-testing — the first fixed a stranding softlock, the second a death with
  no reaction window.
- **Agents never spawn on the roof at level start**, so a run can never open with
  an unavoidable hit.
- **Score persistence** is `localStorage` only (`elevatorHeist.best`); there is no
  server, matching every other game in this repo.
- **One canvas size** (720×640), no responsive scaling, consistent with the rest
  of the collection.
