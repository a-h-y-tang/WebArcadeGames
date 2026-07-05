# Asteroids — Design

## Concept

Asteroids is a classic vector-shooter arcade game. You pilot a small
triangular ship adrift in a field of tumbling space rocks. The ship
rotates, thrusts in the direction it is facing, and fires bullets. Every
asteroid you shoot breaks into smaller, faster fragments until the
smallest ones are vaporised entirely. Clear the whole field and a new,
larger wave arrives. Fly into a rock and you lose a life — run out of
lives and the game is over. The play field wraps around all four edges, so
the ship, bullets and asteroids that leave one side reappear on the
opposite side.

## Mechanics

- **Ship** — a triangle with a heading (`angle`, radians, `0` = pointing
  straight up) and a velocity. It obeys simple Newtonian motion: thrust
  adds acceleration along the heading, and a light drag gradually bleeds
  off speed so the ship coasts to a stop when you let go. Speed is capped
  so the ship stays controllable. The ship wraps around every edge.
- **Rotation** — holding left/right turns the ship at a constant angular
  rate. Rotation is frame-rate independent (radians per millisecond).
- **Thrust** — holding up accelerates the ship along its heading.
- **Bullets** — firing spawns a bullet at the ship's nose travelling in the
  ship's facing direction (plus the ship's own velocity). Bullets move at a
  fixed speed, wrap around the edges, and expire after a fixed lifetime so
  they can't circle the field forever. At most `MAX_BULLETS` may be alive
  at once and there is a short cooldown between shots.
- **Asteroids** — come in three sizes (large → medium → small). Each drifts
  in a straight line at constant velocity and wraps around the edges. A
  bullet that touches an asteroid destroys the bullet and "hits" the rock:
  a large or medium rock splits into two smaller rocks (flying apart in new
  directions, slightly faster), while a small rock is destroyed outright.
  Smaller rocks are worth more points.
- **Score / best** — points are awarded per asteroid hit by size. The
  current score is shown in the HUD; the best score is persisted to
  `localStorage` under the key `asteroids-best`.
- **Lives** — you start with 3. Colliding with any asteroid costs a life
  and respawns the ship at the centre, stationary, with a brief window of
  invulnerability (during which asteroid collisions are ignored). Losing
  the last life ends the game.
- **Levels / waves** — clearing every asteroid starts the next wave with
  one more large asteroid than the last and a slightly higher asteroid
  speed, so play gets progressively harder. Waves are endless; the only
  terminal state is running out of lives.

## Controls

- **← / →** or **A / D** — rotate the ship left / right
- **↑** or **W** — thrust
- **Space** — fire (when playing); also starts the game from the title /
  game-over screen
- **P** — pause / resume
- **Start button / Space / any arrow / WASD** — start (or restart) the game

## State machine

`idle → running ⇄ paused → over → running …`

- `idle` — title screen, overlay visible, ship resting at centre, a wave of
  asteroids already drifting behind the overlay.
- `running` — full physics and input active.
- `paused` — physics frozen, overlay shows "Paused".
- `over` — all lives lost, overlay shows "Game Over" and the final score.

## Testable surface

To make the game deterministic and easy to drive from Playwright, the
following are exposed as globals, mirroring the convention established by
the Snake and Breakout games:

- State: `state`, `score`, `best`, `lives`, `level`
- Objects: `ship`, `bullets` (array), `asteroids` (array)
- Constants: `WIDTH`, `HEIGHT`, `SHIP_R`, `BULLET_SPEED`, `BULLET_LIFE`,
  `MAX_BULLETS`, `ASTEROID_R` (radius by size), `LIVES_START`
- Functions: `startGame()`, `endGame()`, `step(dtMs)`, `fireBullet()`,
  `spawnAsteroid(x, y, size, vx, vy)`, `loseLife()`

`step(dtMs)` advances all physics (rotation from held keys, thrust,
integration, wrapping, bullet/asteroid collisions, ship/asteroid
collisions, wave clearing and life loss) by an explicit number of
milliseconds without relying on `requestAnimationFrame` timing, so every
behaviour can be tested deterministically.

## Assumptions

- **Canvas size 500×500.** Kept identical to the other arcade games for
  visual consistency. A square wrap-around field works well for Asteroids.
- **Simpler interpretation, chosen deliberately:**
  - **No flying-saucer enemy.** Classic Asteroids has a UFO that shoots
    back; this first version is ship-versus-rocks only, for a focused
    scope. (Noted here so it's a known omission, not an oversight.)
  - **No hyperspace teleport.** Another classic extra left out to keep the
    control set small.
  - **Thrust-only movement with drag.** The ship always coasts and slows;
    there is no reverse thrust or instant stop.
- **Deterministic where it matters for tests.** Ship, bullet and collision
  physics are fully deterministic given a `step(dtMs)`. Only cosmetic /
  gameplay-flavour choices (initial asteroid spawn positions, the exact
  direction fragments fly when a rock splits) use `Math.random`; tests
  assert on counts, sizes, scores and reflected directions rather than
  exact random positions, so randomness never makes a test flaky.
- **Asteroids never spawn on top of the ship.** At the start of a wave,
  asteroid spawn positions are pushed away from the centre so the player
  isn't killed instantly.
- **Respawn invulnerability.** After losing a life (and at the very start of
  a game) the ship is briefly invulnerable. Collision tests that want to
  observe a life loss set `ship.invuln = 0` first, consistent with the
  direct-state-manipulation style of the other games' tests.
- **Endless waves.** There is no final "You Win" screen; clearing a wave
  simply starts a harder one. The only game-ending condition is losing all
  lives.
