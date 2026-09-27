# Curling — Design

## Concept

Curling is a turn-based ice sport played against the computer. You and the CPU
alternate sliding 12-pound granite **stones** up a sheet of ice toward the
**house** — the target rings at the far end. A stone slows under friction and
**curls** sideways depending on the handle (rotation) you put on it, and stones
that meet on the way knock each other around.

Once all eight stones of an **end** have been delivered, the team with the stone
nearest the **button** (the centre of the house) scores one point for every one
of its stones lying closer than the opponent's best. Four ends decide the match.

Curling is a game of touch rather than reflexes: the whole skill is choosing the
weight (how hard to throw), the line (where to aim), and the handle (which way
to curl), and then living with the position you have created.

## The sheet

The canvas is 400 × 700 with the house at the top and the hack — where you throw
from — at the bottom. Real sheets are far longer relative to their width; the
approach is compressed so the whole sheet fits on one screen.

| Feature | Position | Meaning |
|---|---|---|
| Back line | `y = 88` (`HOUSE_Y - RING_12`) | A stone past this line is out of play |
| Button / tee line | `y = 160` (`HOUSE_Y`) | Distance to here decides the scoring |
| House rings | radii 72 / 48 / 24 / 10 | Twelve-, eight-, four-foot and the button |
| Far hog line | `y = 380` (`HOG_Y`) | A stone that stops short of this is swept off |
| Release line | `y = 640` (`RELEASE_Y`) | Every stone is delivered from here, on the centre line |
| Side lines | `x = 0` and `x = 400` | A stone touching a side is out of play |

## Mechanics

### Delivery

A stone leaves the hack at `MIN_SPEED + power * (MAX_SPEED - MIN_SPEED)`
(140–280 px/s), on a heading of `aim` radians either side of the centre line
(clamped to ±0.22 rad). Weight, line and handle are all chosen before the throw
and cannot be changed once the stone is moving — there is no sweeping.

The usable weight band runs from roughly 25 % (just crosses the hog line) to
about 84 % (just stays inside the back line); draw weight to the button sits
near 71 %. Anything outside that band is a wasted stone, which is exactly the
tension the real game has.

### Motion

Every stone integrates with two accelerations:

- **Friction** — a constant `FRICTION` (60 px/s²) deceleration along the
  direction of travel. A stone stops dead once its speed falls below
  `STOP_SPEED`, so the sheet always comes to rest in finite time.
- **Curl** — a constant `CURL_ACCEL` (6 px/s²) *perpendicular* to the direction
  of travel, signed by the stone's handle. Because the acceleration is applied
  across the path rather than along it, the heading rotates as the stone slows
  and the track bends into the characteristic banana curve. An in-turn
  (`handle = +1`) curls right; an out-turn (`handle = -1`) curls left.

Collisions are equal-mass and elastic: two touching stones swap the components
of their velocities along the line of centres, and any overlap is pushed apart
evenly. A dead-weight hit therefore transfers the shooter's speed to the target
and leaves the shooter sitting where it struck, which is what granite on ice
does closely enough to feel right.

### Out of play

- **Side lines and back line** take a stone out the instant it crosses them,
  mid-slide.
- **The hog line** is applied once the sheet is still: anything resting below
  `HOG_Y` is swept off.

### Scoring an end

`scoreList()` is a pure function of a list of stones:

1. Keep the stones in the house — any part of the stone overlapping the
   twelve-foot ring counts, i.e. `distance - STONE_R < RING_12`.
2. If none, the end is **blank** (no points).
3. Otherwise the team owning the closest stone takes one point for each of its
   stones closer than the opponent's nearest in-house stone.

The team that scores throws **first** in the next end — meaning it gives up the
hammer (last stone), which is the real advantage in curling. A blank end leaves
the order unchanged. The computer holds the hammer in end 1.

After `ENDS` (4) ends the higher total wins; equal totals are a tie.

## The computer opponent

Because the physics are pure functions over a list of stones, the CPU can simply
*try* deliveries before making one. `planCpuThrow()` runs a 7 × 7 × 2 grid of
(weight, line, handle) candidates through `simulateThrow()` — each one a full
simulation on a throwaway copy of the current sheet, collisions and all — and
scores the resulting position with `evaluatePosition()`:

```
value  =  +10 per point the CPU would score  (or -10 per point conceded)
          - (distance of the CPU's best stone from the button) / 100
          + 0.4 per CPU stone still in play
```

This gets takeouts and draws for free: if hitting an opposing shot rock out
scores better than drawing around it, the search finds the hit without any
special-case code.

The chosen plan is then thrown with a small **execution error** (±3.5 % weight,
±0.018 rad line) drawn from a seeded LCG, so the computer misses often enough to
be beatable and `setSeed(n)` makes any delivery exactly reproducible.

## Code structure

`game.js` is a single classic (non-module) script, so every function and piece
of state is a plain global that the Playwright tests can reach — the same
approach Kaboom, Snake and Tetris use in this repo.

| Section | Responsibility |
|---|---|
| Constants | Sheet geometry, physics, match length |
| RNG | Seedable LCG for the CPU's execution error |
| Aim / weight / handle | `setAim`, `setPower`, `setHandle`, `toggleHandle` |
| Stones | `placeStone`, `launchStone`, `throwStone`, `currentTeam` |
| Physics | `integrate`, `resolveCollisions`, `removeOutOfBounds`, `advance` |
| Simulation | `step(dt)` for the live sheet, `settle()` to run a delivery out |
| Scoring | `scoreList`, `scoreEnd`, `shotStone`, `isInHouse` |
| Flow | `startGame`, `endDelivery`, `finishEnd`, `nextEnd`, `gameOver` |
| CPU | `simulateThrow`, `evaluatePosition`, `planCpuThrow`, `cpuThrow` |
| Rendering | `drawSheet`, `drawStone`, `drawAimGuide`, `predictPath`, `draw` |
| Loop & input | `frame`, keyboard and mouse handlers |

### Determinism and testing

Two things make the game testable without fighting the clock:

- **All motion goes through `advance(list, h)`**, which is pure over the list it
  is handed. `step(dt)` drives the live sheet in 1/240 s sub-steps so a fast
  stone can never tunnel through a stationary one, and `settle()` simply runs
  `step()` until the sheet is at rest. Tests call `throwStone(); settle();` and
  read the exact resting position.
- **`setAutoPlay(false)`** detaches the `requestAnimationFrame` loop, so the
  animation and the CPU's think-timer cannot perturb a test that is driving the
  simulation by hand. A few tests turn it back on to check that live play and
  the computer's automatic turn actually work.

The aim guide the player sees is the same physics again: `predictPath()`
integrates a lone ghost stone forward with no other stones on the sheet, so it
shows the curl of the shot but not what it will hit.

## Controls

| Input | Action |
|---|---|
| ← / → | Aim left / right |
| ↑ / ↓ | More / less weight |
| H | Toggle the handle (in-turn ↔ out-turn) |
| Space | Throw · advance to the next end · start a new game |
| Mouse move | Aim at the pointer |
| Click | Throw at the pointer |

## Assumptions

These were decisions taken without a human to ask; the simpler reading won each
time.

- **Branch naming.** The task asked for a branch named after the game
  (`curling`), but this session is configured to develop and push on
  `claude/loving-euler-816lbl`. The session's branch requirement wins, so the
  work lives there rather than on a `curling` branch.
- **Four ends, four stones each.** A real game is eight or ten ends of eight
  stones per team. Four ends of four stones keeps a match to a few minutes,
  which suits a browser arcade.
- **No sweeping.** Sweeping would need a second, continuous control during the
  slide. Weight, line and handle at release are the whole game here.
- **The hog rule applies to every stone**, not just the delivered one. In real
  curling a stone knocked back short of the hog line stays in play; here the
  sweep at the end of each delivery removes anything resting short. It keeps
  one rule instead of two and never leaves stones stranded in the approach.
- **No free guard zone.** Guards in the first stones of an end can be taken out
  immediately, unlike the modern five-rock rule.
- **Stones are equal-mass and collisions are perfectly elastic**, with no spin
  transfer between stones and no loss of energy on impact.
- **Out of play is judged on the stone's centre for the back line** and on the
  stone's edge for the side lines — the simplest checks that look right.
- **A tied match is a tie**, with no extra end.
- **The curl acceleration is constant.** Real stones curl hardest as they slow;
  a constant sideways acceleration already produces a curved track and is one
  line of physics instead of a tuned curve.
- **The CPU always has the same skill.** There is no difficulty setting; its
  execution error is fixed.
- **No persistence.** Unlike some games in this repo there is no saved best
  score — a curling result is a match score, not a high score.
