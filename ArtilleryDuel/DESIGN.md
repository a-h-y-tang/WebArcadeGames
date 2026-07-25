# Artillery Duel — Design

## Concept

A turn-based artillery duel in the tradition of *Scorched Earth* and QBasic
*Gorillas*. Your tank sits on the left of a flat battlefield; a CPU tank sits on
the right. Each turn you choose a barrel **angle** and a firing **power**, then
lob a shell across the field. Gravity pulls the shell into a parabola and a
per-round **wind** nudges it sideways, so every shot is a little aiming puzzle.
Land a shell on the enemy tank to win the round; get hit yourself and the duel
is over.

## Mechanics

- The field is the 500 × 500 canvas with a flat ground line at `GROUND_Y`.
- The player tank is fixed at the left (`PLAYER_X`), the CPU tank at the right
  (`CPU_X`); both rest on the ground.
- Turns alternate. On the **player's** turn you adjust aim and fire; on the
  **CPU's** turn the computer aims and fires automatically after a short delay.
- A shell is a projectile integrated by `step(dtMs)`:
  - initial velocity comes from `launchVelocity(angle, power, dir)` — the player
    fires up and to the right (`dir = +1`), the CPU up and to the left
    (`dir = -1`);
  - every millisecond, `wind` accelerates it horizontally and `GRAVITY`
    accelerates it downward;
  - the shell is integrated in small fixed sub-steps so fast shells never tunnel
    through a tank.
- A shot resolves when the shell hits the enemy tank (within `HIT_R`), lands on
  the ground, or flies off the sides:
  - **hit** on the CPU → the player wins the round;
  - **hit** on the player → game over;
  - **miss** → the turn passes to the other tank.

## Rounds & scoring

Winning a round increments the **score** and the **round** counter, re-rolls the
wind, and hands the next turn to the player. The run ends the first time the
player's tank is hit. **Best** score is persisted in `localStorage` under
`artillery-best`.

## CPU AI

`cpuAim()` solves the level-ground range equation for a 45° shot
(`v₀ = √(D · g)`, `power = v₀ / SPEED_SCALE`) to find a power that would just
reach the player with no wind, then adds a small random error to both angle and
power so the CPU is beatable and never plays identically twice. The result is
always clamped into the legal angle/power range. Tests that need a fully
deterministic CPU set `aiEnabled = false` and drive `fireShell()` directly.

## Controls

- **↑ / ↓** — raise / lower the barrel angle.
- **← / →** — decrease / increase firing power.
- **Space** — fire (on the title / game-over screen, Space starts a new duel).
- **P** — pause / resume.
- **Start button** — start / resume with the mouse.

## Determinism / testability

All state and the physics entry point `step(dtMs)` live at top level so
Playwright's `page.evaluate()` can reach them, matching the other games in this
repo. `step(dtMs)` integrates the in-flight shell by an explicit number of
milliseconds and never depends on `requestAnimationFrame` timing, so tests
advance the world by calling `step(ms)`. `launchVelocity`, `cpuAim`,
`aimAngle`, `aimPower`, `fireShell`, `winRound` and `endGame` are all reachable
for focused unit-style assertions.

## Assumptions

Where the brief was open, the simpler reading was taken and is recorded here:

- **Flat terrain** — no hills or destructible ground. This keeps the range
  maths (and the tests) clean; the wind provides the shot-to-shot variety.
- **One CPU opponent**, single tank each, no repositioning between rounds.
- **A tie is impossible** — turns are strictly sequential (only one shell is
  ever in the air), so each shot has a single owner and a single outcome.
- **Discrete aiming** — each arrow press nudges angle/power by a fixed step
  rather than a held-key ramp, which is predictable and easy to test.
- Fixed 500 × 500 canvas, consistent with the rest of the repo; no responsive
  resizing.
