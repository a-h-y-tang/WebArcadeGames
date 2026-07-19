# Tapper — Design

## Concept

**Tapper** is a frantic serving game inspired by the 1983 arcade classic *Root
Beer Tapper*. You are the bartender working four counters at once. Thirsty
patrons stream in from the left end of each bar and march steadily toward you.
Slide a mug of root beer down the right lane at the right moment to serve a
patron — a served patron is happy and leaves. Let a patron reach your end of the
bar without a drink and you lose a life. Serve everyone in a wave and the next
crowd arrives thirstier and faster.

The challenge is that you can only pour down **one lane at a time** — the lane
you're standing at — so the game is about darting between the four bars and
timing each pour before a patron reaches the counter's end.

## Mechanics

- **Four lanes.** The bartender occupies exactly one lane at a time (rows 0–3),
  standing at the right end. Moving up/down changes the active lane.
- **Patrons** enter at the left of a lane and advance to the right at a
  wave-dependent speed. If a patron's position reaches the counter end
  (`DANGER_X`), the player loses a life and that patron is removed.
- **Mugs.** Pouring sends a mug sliding left down the bartender's current lane.
  When a mug catches up to a patron in that lane, that patron is **served**:
  both the mug and the patron are removed and the player scores. A mug always
  serves the *most advanced* (right-most) patron it overlaps, so you defend the
  patron nearest the counter first.
- **Wasted mugs.** A mug that slides all the way to the left wall without
  catching anyone is simply removed (no penalty) — see Assumptions.
- **Lives** start at 3. Losing all of them ends the game.
- **Waves.** Each wave releases a fixed number of patrons
  (`patronsForWave = 4 + wave*2`, so wave 1 = 6). When every patron has entered
  *and* the bars are clear, the next wave begins with faster patrons and a
  shorter spawn interval.
- **Scoring.** Each served patron is worth `10 * wave` points. The best score is
  persisted to `localStorage`.

## Controls

| Input | Action |
|---|---|
| ↑ / ↓ or W / S | Move the bartender between the four lanes |
| Space / Enter / click | Pour a mug down the current lane (also starts the game) |
| P | Pause / resume |

## Code structure

Following the repo convention, the game state and pure step functions are
exposed as globals so the Playwright suite can build exact scenarios:

- `state` — `'idle' | 'running' | 'paused' | 'over'`.
- `bartenderLane` — integer lane index 0–3.
- `patrons` — array of `{ lane, x, vx }` (x is the patron's center; vx > 0).
- `mugs` — array of `{ lane, x, vx }` (vx < 0, sliding left).
- `score`, `best`, `lives`, `wave`, `patronsToSpawn`, `patronSpeed`.
- `update(dt)` — the time-based integrator (seconds): moves mugs and patrons,
  spawns patrons on a timer, resolves mug↔patron serves, discards wasted mugs,
  applies the danger-line life loss, and advances the wave when the lanes are
  clear. It is deliberately not gated on `state` so tests can call it directly.
- `pour()`, `spawnPatron()`, `nextWave()`, `loseLife()`, `startGame()`,
  `endGame()`, `pauseGame()`, `resumeGame()` — lifecycle helpers.

Mug and patron **motion and collision are fully deterministic** — the only
randomness is which lane a spawned patron appears in (`Math.random`), which
never affects the physics the tests assert. Tests place patrons and mugs at
known positions and call `update()` directly.

## Assumptions

Choices made where the original was ambiguous or where the simpler
interpretation was preferred:

- **No returning empty mugs.** In the arcade original, served patrons slide
  their empty mugs back and you must catch them. That second mechanic is dropped
  here; the game is purely about serving advancing patrons, which keeps the
  rules and tests clean.
- **A wasted mug costs nothing.** Rather than penalizing an over-poured mug, a
  mug that reaches the left wall is quietly removed. The skill is in timing and
  lane-switching, not in mug economy.
- **Fixed number of lives (3), no bonus lives.**
- **Points scale with the wave** (`10 * wave`) to reward surviving longer.
- **A patron is served the instant a mug overlaps it**, with no pouring/drinking
  animation gating the logic, so the simulation stays deterministic.
- **One bartender, one active lane** — you cannot pour into a lane you are not
  standing in.
- **Desktop-first fixed canvas** of 480×640.
