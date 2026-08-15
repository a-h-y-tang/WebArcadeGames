# Robot Arena — Design

## Concept

A twin-stick arena shooter. The player is trapped in a sealed testing arena
with waves of hostile machines. Movement and aiming are independent: you walk
with **WASD** and fire with the **arrow keys**, so you can back away from a
pack while shooting into it. Scientists wander the floor; touching one rescues
them for a bonus that grows with each rescue inside the same wave. Clearing
every robot advances to the next, larger wave. Three lives, then it's over.

Everything is drawn on a single 640×480 canvas with no images or audio assets,
so the game opens straight from `index.html` with no build step or server.

## Files

| File | Role |
|---|---|
| `index.html` | HUD markup, canvas, overlay, controls help |
| `style.css` | Neon-on-dark arcade styling for the shell and overlay |
| `game.js` | All game state, simulation and rendering (classic script) |
| `tests/robot-arena.spec.js` | Playwright suite (61 tests) |

## Architecture

`game.js` is a single classic (non-module) script, matching Slime Volley,
Kaboom and Tetris in this repo. Top-level `let`/`const` bindings and function
declarations are reachable from `page.evaluate()` as plain globals, which is
what the tests drive.

The world advances exclusively through `step(dt)`:

```
step(dt)
  ├─ updatePlayer(dt)        input vector → velocity → clamp to arena, tick invulnerability
  ├─ updateFiring(dt)        cooldown timer → spawn bullet along the aim vector
  ├─ updateBullets(dt)       move, kill at walls, collide with enemies (hitEnemy)
  ├─ updateEnemies(dt)       per-type behaviour, separation, clamp, contact damage
  ├─ updateEnemyBullets(dt)  move, kill at walls, contact damage
  ├─ updateHumans(dt)        wander, bounce, rescue on touch
  ├─ updateParticles(dt)     decay debris
  └─ wave timer              all enemies dead for WAVE_DELAY → nextWave()
```

`step()` returns immediately unless `state === 'running'`, so idle, paused and
game-over states all freeze the world with one guard. The real-time loop
(`frame()`) only measures `dt`, calls `step()` and `draw()` — it holds no
logic of its own, so a test simulating 60 fixed 1/60 s steps sees exactly what
a player sees over one second.

State machine: `idle → running ⇄ paused`, and `running → over → running`
(restart). The overlay is shown for every state except `running`.

## Mechanics

### Player

- Radius 10, speed 190 px/s, clamped inside the 16 px arena wall.
- The movement vector is normalised, so diagonals are not faster.
- Firing is on a 0.14 s cooldown; bullets travel 430 px/s and die at the wall.
- Losing a life recentres the player, clears every enemy bullet and grants
  `INVULN_TIME` (2 s) of invulnerability, drawn as a blinking shield ring.

### Enemies

| Type | Behaviour | Speed | HP | Points |
|---|---|---|---|---|
| Grunt | Walks straight at the player with a slight sway | 62 | 1 | 100 |
| Sentry | Repositions slowly between anchors, fires every 2.2 s | 38 | 2 | 150 |
| Drifter | Constant velocity, ricochets off the walls | 168 | 1 | 125 |
| Hunter | Chases the player's position a quarter-second ahead | 128 | 1 | 200 |

Each type's speed ramps by a per-type `ramp` value for every wave beyond the
first. Grunts appear from wave 1, sentries and drifters from wave 2, hunters
from wave 3; the mix tilts toward the nastier types as waves climb. A light
separation force keeps a pack from collapsing into a single blob, and every
enemy is clamped inside the arena each tick.

### Humans

Scientists wander with a random heading that changes every 0.8–2.2 s, bouncing
off the walls. Touching one rescues them: the rescue chain increments (capped
at 10) and awards `100 × chain`, so the first rescue in a wave is worth 100,
the second 200, and so on. The chain resets at the start of every wave.

### Waves

`enemyCountForWave(w) = min(5 + 2w, 26)` robots and
`humanCountForWave(w) = max(2, 5 - floor((w-1)/2))` scientists spawn at random
free spots at least `SPAWN_CLEARANCE` (110 px) from the player. When the last
robot dies, a 1.5 s pause runs before the next wave arrives; the new wave
clears leftover enemy fire and grants 1.5 s of invulnerability so the player
never spawns into a crossfire.

### Scoring

- Robot destroyed: 100–200 points by type.
- Scientist rescued: `100 × rescue chain`.
- The high score is persisted in `localStorage` under `robot-arena-high` and
  written only when the run beats it.

## Controls

| Input | Action |
|---|---|
| `W` `A` `S` `D` | Walk (8-way, normalised diagonals) |
| `↑` `↓` `←` `→` | Fire (8-way, independent of movement) |
| `Space` | Start / restart |
| `P` | Pause / resume |
| Start button | Start, restart, or resume from pause |

Window blur clears held keys, so alt-tabbing mid-run doesn't leave the player
walking into a wall.

## Testing

Written test-first with `@playwright/test`. The suite (61 tests) loads
`index.html` over `file://` and drives the exposed globals:

- `step(dt)`, `startGame()`, `togglePause()`, `loseLife()`, `updateHud()`, `draw()`
- `moveDir(dx, dy)`, `fireDir(dx, dy)`, `setPlayerPos(x, y)`
- `spawnEnemy(type, x, y)`, `spawnHuman(x, y)`, `spawnEnemyBullet(x, y, vx, vy)`, `hitEnemy(e)`
- state: `state`, `score`, `wave`, `lives`, `rescueChain`, `rescued`, `shotsFired`,
  `player`, `enemies`, `bullets`, `enemyBullets`, `humans`

Coverage: idle state and HUD, starting and spawn placement, movement including
diagonal normalisation and wall clamping, firing cadence and bullet lifetime,
each enemy behaviour, damage and invulnerability, rescues and the bonus chain,
wave progression, pausing, game over, high-score persistence, and that the
canvas is actually painted.

Two helpers keep the timing-sensitive tests honest: `s(n)` runs `n` fixed
1/60 s steps, and `hold()` parks a motionless drifter in a corner so a long
test isn't disturbed by a wave rolling over mid-simulation.

Run just this game's tests with:

```powershell
npx playwright test RobotArena/tests/
```

## Assumptions

Decisions taken without further input, per the simpler-interpretation rule:

- **Keyboard-only twin stick.** Robotron-style cabinets use two joysticks. The
  keyboard equivalent chosen here is WASD to move and arrow keys to fire; no
  mouse aiming is implemented, which keeps the input surface (and its tests)
  small.
- **Branch naming.** The task asked for a branch named after the game
  (`robot-arena`), but this session is also required to develop and push on
  its designated branch. The designated branch wins, since pushing elsewhere
  is explicitly forbidden; the game folder and games.json id carry the
  kebab-case name instead.
- **Robots ignore the scientists.** In the arcade original, enemies can kill
  the humans you're trying to save. Here scientists are purely a bonus
  opportunity, which removes a whole class of AI and timing edge cases.
- **Waves persist through death.** Losing a life recentres the player and
  clears enemy fire but does not restart the wave, so a hard-won wave isn't
  undone by one mistake.
- **One hit, one life.** No shields or power-ups; damage is binary and every
  enemy contact or enemy bullet costs a life.
- **No extra lives.** Score awards no additional lives, so a long run is
  limited by the three starting lives.
- **Randomised spawns.** Wave composition and spawn positions are random
  rather than seeded. Tests avoid depending on the randomness by clearing the
  arrays and spawning exactly what they need.
