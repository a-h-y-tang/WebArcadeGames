# Time Pilot — Design

A 360-degree free-flight shooter. The player's plane sits permanently at the
centre of the screen and the *world* scrolls past it, so turning the plane turns
the whole battlefield. Shooting down enough enemies tears a hole in time and
drops the player into the next era, each one faster and meaner than the last.

Nothing else in this repo plays like it: `Asteroids` has inertia and screen
wrap, `Galaga` / `SpaceInvaders` are fixed-axis, and `Scramble` / `Defender`
side-scroll on rails. Here the camera is welded to a plane that never stops
moving and can point anywhere.

## Concept

- Fly a time-travelling fighter through five eras: 1910 biplanes, 1940
  prop fighters, 1970 jets, 1983 gunships, 2001 saucers.
- Each era has a kill quota. Fill it and the clock jumps to the next era;
  clear 2001 and the cycle restarts one difficulty step harder.
- Pilots shot down over the battlefield bail out. Fly *into* a parachute to
  rescue the pilot for a 1000-point bonus — the only way to score big.
- Three lives. An enemy plane, or one of its bullets, costs one.

## Mechanics

### Flight model

The plane has a heading and a constant forward speed (`PLAYER_SPEED`,
150 px/s); there is no throttle and no inertia, which is what makes the game
about *aiming the world* rather than managing momentum. Left/right rotate the
heading at `TURN_RATE` (2.6 rad/s). The plane's world position advances along
its heading every tick and the camera is pinned to it, so the player is drawn at
`(W/2, H/2)` forever and everything else is drawn at `world - camera`.

The world is unbounded — there are no walls. Any enemy or bullet further than
`DESPAWN_DIST` (560 px) from the plane is deleted, and new enemies arrive from
`SPAWN_DIST` (420 px) off-screen, so the action always converges on the player.

### Guns

- `SPACE` (or a click on the canvas) fires along the current heading at
  `BULLET_SPEED` 430 px/s.
- `FIRE_COOLDOWN` 0.18 s between shots and at most `MAX_BULLETS` (6) in flight,
  so the gun is a rhythm, not a hose.
- Bullets live `BULLET_LIFE` 1.1 s, which is slightly less than the time to
  reach the despawn ring — a miss is a committed mistake.

### Enemies

Enemies spawn on the despawn ring at a random bearing and fly a weak homing
course: each tick they steer toward the player at `ENEMY_TURN` (1.1 rad/s) and
move at their era's speed. Weak homing means they overshoot and come back round,
which produces the swirling dogfight the original arcade game is known for,
without any per-enemy state machine.

An enemy whose nose is within ~0.5 rad of the player and inside 320 px may fire;
the chance per second is the era's `fireRate`. Enemy bullets are slower
(190 px/s) than the player's and live 2.6 s.

The number of enemies alive at once is capped per era (`maxAlive`), and a fresh
one is dripped in on `ENEMY_SPAWN_GAP` (0.9 s) while below the cap.

### Eras and waves

| Wave era | Year | Enemy speed | Max alive | Quota | Points |
|---|---|---|---|---|---|
| Biplanes | 1910 | 95 | 4 | 8 | 100 |
| Prop fighters | 1940 | 112 | 5 | 10 | 200 |
| Jets | 1970 | 130 | 5 | 12 | 300 |
| Gunships | 1983 | 146 | 6 | 14 | 400 |
| Saucers | 2001 | 162 | 6 | 16 | 500 |

`wave` is 1-based and never resets; the era is `(wave - 1) % 5`, so wave 6 is
1910 again but every enemy speed is multiplied by `1 + 0.08 * cycle`. Hitting
the quota increments `wave`, zeroes `kills`, clears the battlefield of enemy
bullets (a free breath between eras) and shows a banner for `BANNER_TIME` 2 s.

### Parachutes

The game keeps up to `MAX_CHUTES` (3) parachutes drifting in world space at
`CHUTE_DRIFT` 18 px/s downward, dropped on a `CHUTE_GAP` (4 s) timer 200–320 px
away inside `CHUTE_ARC` — a wedge ahead of the plane. Dropping them anywhere on
the circle was the first version and it did not work: the plane cannot stop or
turn tightly, so a chute behind it is a full loop away and has usually drifted
past `CHUTE_DESPAWN` before anyone arrives. Chutes use their own, longer
despawn radius (800 px) for the same reason — they are meant to be chased.

Touching one scores `RESCUE_POINTS` 1000 and bumps `rescued`. They are
harmless; the risk is that chasing one means not watching the dogfight.

### Damage and lives

A hit (enemy bullet, or flying into an enemy) costs a life and grants
`INVULN_TIME` 2 s of blinking invulnerability during which nothing can hurt the
player and the battlefield's enemy bullets are cleared. At zero lives the state
becomes `gameover`, the best score is written to `localStorage`
(`timepilot-best`), and the overlay returns.

## Controls

| Input | Action |
|---|---|
| `←` / `A` | Turn left (counter-clockwise) |
| `→` / `D` | Turn right (clockwise) |
| `SPACE` | Fire (also starts the game from the title/game-over overlay) |
| Click canvas | Fire |
| `P` | Pause / resume |

## Code shape

Everything lives in `game.js` as a classic script with its interesting state at
the top level (`state`, `score`, `lives`, `wave`, `kills`, `player`, `enemies`,
`bullets`, `enemyBullets`, `chutes`, `autoRun`). This is deliberate: the
Playwright suite in `tests/time-pilot.spec.js` drives the game through exactly
those names, calling `physicsStep(dt)` by hand with `autoRun = false` so every
assertion is about a fixed number of deterministic simulation steps rather than
about wall-clock animation.

Randomness goes through a small seeded LCG (`rnd()` / `seedRng()`) so a test can
pin spawn bearings and fire rolls.

`physicsStep(dt)` is the whole simulation in order: input → player → bullets →
enemies → enemy bullets → chutes → collisions → spawning → wave check. `draw()`
is pure rendering and reads no input, so a test can step the simulation without
a frame ever being painted.

## Assumptions

These were ambiguous in the task; the simpler reading was taken each time and
recorded here.

1. **Branch naming.** The task asked for a branch named after the game
   (`time-pilot`), while the session's standing instructions pin development and
   pushes to `claude/compassionate-ramanujan-vbtng4`. The local work was done on
   `time-pilot` and pushed to the mandated branch, which is the only one the
   session is permitted to push.
2. **"Novel" means new to this repo**, not newly invented — the repo is a
   collection of arcade classics, so a classic absent from the catalogue fits
   the pattern. Time Pilot (Konami, 1982) is reimplemented from its documented
   mechanics, not copied: no original art, audio, or data is used.
3. **No boss fights.** The arcade original ends each era with a large
   multi-part mothership. That would be a second collision model and a second AI
   for one scripted moment, so era transitions are a banner plus a difficulty
   step instead.
4. **No sound.** Every other game in the repo is silent and the tests run
   headless; audio would be untestable decoration.
5. **Single difficulty, no menus.** Difficulty is the era cycle itself.
6. **Lives, not shields**, with a short invulnerability window rather than a
   respawn animation, so the simulation never has a "dead but not yet
   respawned" state for tests to trip over.
7. **The stale game-browser e2e count was left alone.** `game-browser/e2e/`
   asserts 109 cards against a `games.json` that already listed 135 games before
   this change; it is an Angular suite outside the root `playwright.config.js`
   (which matches `**/tests/*.spec.js`) and was already failing, so fixing it is
   not part of adding this game. `games.json` itself *was* updated so the game
   browser lists and launches Time Pilot.
