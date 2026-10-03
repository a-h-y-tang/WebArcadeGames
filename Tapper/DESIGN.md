# Tapper — Design

## Concept

A single-screen arcade service game. You are the bartender at a four-lane bar.
Thirsty patrons shuffle in from the far (left) end of each lane and walk
steadily towards the taps on the right. You stand at the tap end, slide between
the four lanes, and send mugs sliding down a lane to meet them. A mug knocks a
patron back down the bar while they drink; once they have had their fill they
wander out of the door and you score. Each drink also sends an empty mug sliding
back up the lane towards you — be standing in that lane to catch it, or it
sails past and shatters.

Lose a life when any of three things happens:

1. A patron reaches the taps (they grab you by the apron).
2. A poured mug runs the whole length of a lane without meeting a patron and
   smashes on the floor at the door end.
3. An empty mug comes back up a lane you are not standing in and shatters
   behind you.

Serve the whole wave to advance a level: patrons walk faster, there are more of
them, and from level 4 onwards they need more than one drink before they leave.

## Board geometry

The canvas is 760 × 480. Four lanes of 104 px start 40 px from the top, so lane
centres sit at y = 92, 196, 300, 404 (`laneY(lane)`).

Along the x axis:

| Constant | Value | Meaning |
|---|---|---|
| `BAR_LEFT` | 70 | door end — patrons enter here, poured mugs smash just past it |
| `TAP_X` | 664 | the taps; a patron reaching `TAP_X - GRAB_DIST` ends a life |
| `CATCH_X` | 686 | the line an empty mug must be caught on |
| `PLAYER_X` | 704 | where the bartender is drawn |

## Mechanics

**Patrons** (`customers`) are `{ lane, x, need, state, push }`.

- `advancing` — walk right at `customerSpeed(level)` px/s.
- `drinking` — entered when a mug lands. The patron is pushed left for
  `PUSH_DIST` px at `PUSH_SPEED` px/s (clamped at `BAR_LEFT`). When the push
  finishes they toss an empty mug back up the lane and either resume advancing
  (`need > 0`) or start `leaving`.
- `leaving` — walk left at `LEAVE_SPEED` px/s; once past the door they are
  removed, scoring `LEAVE_POINTS` and counting towards the wave.

**Mugs** (`mugs`) slide left at `MUG_SPEED` px/s. A mug lands on the
right-most non-leaving patron in its lane within `HIT_DIST` px, scoring
`SERVE_POINTS`. A mug that passes the door end costs a life.

**Empties** (`empties`) slide right at `EMPTY_SPEED` px/s. Crossing `CATCH_X`
resolves immediately: caught (for `CATCH_POINTS`) when the bartender is in that
lane, otherwise a life is lost. Catching is automatic — being in the lane is
the whole skill, there is no separate catch button.

**Waves.** Level *L* serves `3 + L` patrons, spawned one at a time every
`spawnInterval(level)` seconds into a lane chosen by a level-seeded LCG, so a
level always plays out the same way. A wave is clear when every patron has been
spawned and the bar is empty of patrons, mugs and empties; that pays
`CLEAR_BONUS × level` and, after a short pause, starts the next level.

**Lives.** Three to start. Losing one clears the bar and replays the current
wave from the beginning after a pause; losing the last one ends the game and
writes the best score to `localStorage` under `tapper-best`.

## Controls

| Input | Action |
|---|---|
| ↑ / ↓ (or W / S) | move between lanes |
| Space | pour a mug down the current lane (`POUR_COOLDOWN` between pours) |
| Click a lane | jump to that lane and pour (mouse shortcut for the two above) |
| P | pause / resume |
| Space (idle or game over) | start a new game |

## Drawing

Each lane is drawn in three passes — the back wall, doorway and tap tower;
then everyone standing at the bar; then the counter top and its front face over
the bottom of them — so the patrons read as standing *behind* the bar rather
than on it. Mugs are drawn last, resting on the counter surface. The lane you
are serving is lit slightly brighter and its catch notch is picked out in
amber, so a glance at the board tells you which lane you are in.

## Balance

A greedy bot that always covers the patron nearest the taps, and drops
everything to catch an incoming empty, clears six levels and dies on level 7,
where patrons walk at 58 px/s and want three drinks each. That is the curve the
constants above are tuned for: comfortable at first, out of reach of
one-lane-at-a-time play by level 7.

## Code shape

`game.js` is a single classic (non-module) script, matching the other games in
this repo: all state and helpers are plain globals so the Playwright specs can
reach them. Motion is expressed per second and advanced only through
`step(dt)`, and the `requestAnimationFrame` loop can be switched off with
`autoStep = false`, which lets the tests drive time exactly. `autoSpawn = false`
additionally stops the wave timer so a spec can place the patrons it cares
about with `spawnCustomer(lane, x)`.

## Assumptions

Written while running unattended, so each ambiguity below took the simpler
reading and is recorded rather than queried.

- **Branch name.** The task asked for a branch named after the game
  (`tapper`), but this session is under standing instructions to develop and
  push on `claude/compassionate-ramanujan-f5lujl`. The standing instruction
  wins; no `tapper` branch is pushed.
- **Pouring is one press, one mug.** The arcade original has you hold the tap
  to fill a mug and release to send it. A single keypress pouring a full mug,
  rate-limited by `POUR_COOLDOWN`, is simpler and keeps the keyboard model the
  same as the rest of the repo.
- **Catching is positional.** No catch key; standing in the lane when the empty
  crosses `CATCH_X` catches it.
- **No tip/bonus-round sub-game.** The original's dancing-girl tips and
  shell-game bonus round are left out; scoring is serves, catches, satisfied
  patrons and a wave bonus.
- **Deterministic lane order.** Spawn lanes come from a level-seeded LCG rather
  than `Math.random`, so a level is reproducible for both players and tests.
- **A life loss replays the current wave** rather than resuming it mid-flight,
  which avoids having to decide what happens to patrons already halfway down
  the bar.
