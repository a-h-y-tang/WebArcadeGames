# Paratrooper — Design

## Concept

A single-screen arcade defence game. You command the only anti-air gun on a
lonely tower. Helicopters sweep in from both sides of the screen and drop
paratroopers. Every trooper that reaches the sand walks toward your tower and
stacks up against it — let four pile up on either side and they scale the wall,
blow the tower and the game is over.

You cannot shoot a man once he is on the ground: the gun cannot depress that
far. The whole game is therefore about clearing the sky before it reaches the
sand.

## Screen layout

```
 (0,0)                                                          (640,0)
   +----------------------------------------------------------------+
   |            ~~~ helicopters cruise between y=50 and y=180 ~~~    |
   |                                                                 |
   |                        o   <- paratrooper under a chute         |
   |                       /|\                                       |
   |                        |                                        |
   |                    ====#====   <- gun, pivot at (320, 300)      |
   |                       |  |     <- tower                         |
   |  x  x            x    |  |                                      |
   |======================================================== y = 380 |
   +----------------------------------------------------------------+
```

- Canvas is a fixed `640 x 420`.
- The sand line is `y = 380`; everything below it is ground.
- The tower stands at the centre (`x = 320`), 28 px wide, its top at `y = 300`.
- The gun pivots at the top of the tower and swings `±1.2 rad` (about ±69°)
  from vertical.

## Mechanics

### Gun

- `←` / `→` swing the barrel; the angle is clamped to `±MAX_ANGLE` so the gun
  can never point at the ground (which is why landed troopers are safe).
- `Space` fires. At most `MAX_BULLETS` (5) shells may be in flight at once and
  a `FIRE_COOLDOWN` of 0.14 s separates shots, so the sky cannot be blanketed.
- Shells travel in a straight line at `BULLET_SPEED` (430 px/s) — no gravity,
  which keeps aiming honest and the collision maths simple.

### Helicopters

- Spawn off either edge at a random altitude between `HELI_MIN_Y` and
  `HELI_MAX_Y` and cross the screen horizontally.
- Each carries `HELI_CAPACITY` (2) troopers and drops one whenever its drop
  timer expires while it is over the drop zone (not too near the edges, and
  never directly above the tower).
- A shell that hits the fuselage destroys the helicopter for `SCORE_HELI` (20)
  points; any troopers still aboard are lost with it, so early kills pay off.

### Paratroopers

Each trooper is in one of three phases:

| Phase | Behaviour |
|---|---|
| `chute` | Descends at `CHUTE_FALL` (52 px/s) under a parachute. Vulnerable to shells — worth `SCORE_TROOPER` (5). |
| `walk` | Has touched the sand. Walks toward the tower at `WALK_SPEED` (30 px/s). Immune to shells. |
| `stacked` | Reached the pile on its side and stands still, one body-width further out than the previous arrival. |

When `STACK_LIMIT` (4) troopers are stacked on the *same* side they climb the
tower and the game ends.

### Difficulty

`wave` advances every `WAVE_SECONDS` (20 s) of play. Each wave shortens the
helicopter spawn interval and raises helicopter speed, both clamped so the
game stays playable rather than turning into noise.

### Scoring

- Helicopter destroyed: 20
- Paratrooper shot in the air: 5
- Best score is kept in `localStorage` under `paratrooper-best`.

## Controls

| Key | Action |
|---|---|
| `←` / `→` (or `A` / `D`) | Swing the gun |
| `Space` | Fire — also starts the game from the title screen |
| `P` | Pause / resume |
| `R` | Restart after a game over |

The **Start** button on the overlay does the same as `Space`.

Held keys auto-repeat, which is what you want for the gun — the cooldown paces
it — so `Space` fires on repeat. `P`, `R` and the restart branch of `Space`
ignore repeats, so a key still held from the shot that lost the tower cannot
restart the run out from under you.

### Feedback

The HUD carries the numbers, but a player mid-shot is not reading it, so three
cues are drawn on the canvas: the barrel tip flashes when a shell leaves it, a
`WAVE n` banner fades in and out on each difficulty step, and the threatened
flank of the tower pulses red once a side is one trooper short of an overrun.

## Code structure

Single classic (non-module) script, `game.js`, matching the rest of this repo
(Slime Volley, Kaboom, Tetris): every piece of state and every function is a
plain global so the Playwright specs can drive the simulation directly.

- **Constants** — geometry, speeds, scoring, all at the top of the file.
- **State** — `state`, `score`, `best`, `wave`, `elapsed`, `turret`,
  `bullets`, `helicopters`, `troopers`, `particles`.
- **`step(dt)`** — advances one slice of simulation: gun swing, cooldowns,
  spawning, bullets, helicopters, troopers, collisions, difficulty, loss check.
  It is a no-op unless `state === 'running'`, which lets tests assert that a
  paused or idle game is frozen.
- **`draw()`** — pure rendering; reads state, never writes it.
- **`frame(now)`** — the `requestAnimationFrame` driver. It converts wall-clock
  time into a `dt` (clamped to 50 ms so a backgrounded tab cannot teleport
  troopers through the ground) and calls `step` then `draw`.
- **`seedRng(n)` / `rng()`** — a small deterministic mulberry32 generator.
  Everything random (helicopter side, altitude, drop timing) goes through it,
  so a test can seed it and get a reproducible wave.

Collision detection is deliberately trivial — shell-vs-helicopter is a
point-in-rectangle test, shell-vs-trooper a circle distance test — because at
these object counts nothing more clever is warranted.

## Testing

`tests/paratrooper.spec.js` drives the page over `file://` with Playwright and
calls the globals directly (`startGame()`, `step(dt)`, `spawnHelicopter()`,
`spawnTrooper()`) rather than trying to win the game through the keyboard.
That keeps every test deterministic: no `requestAnimationFrame` timing, no
reliance on real randomness.

## Assumptions

These were ambiguous in the brief; the simpler reading was taken each time and
recorded here.

1. **Branch name.** The task text asks for a branch named after the game
   (`paratrooper`), but this session's standing instructions pin all work to
   `claude/compassionate-ramanujan-qx5a5u` and forbid pushing elsewhere. The
   designated branch wins; the game folder carries the name instead.
2. **Landed troopers cannot be shot.** The gun's elevation limit means shells
   never reach ground level. This is the central tension of the game rather
   than an oversight — clear the sky or lose the tower.
3. **One life, no continues.** A single stack of four ends the run; the game is
   a score attack against a rising difficulty curve, so lives would only blur
   the score.
4. **Shells ignore gravity.** A ballistic arc would look prettier but makes
   aiming a guessing game at these distances and adds nothing testable.
5. **Helicopters never collide with anything but shells** — they fly well above
   the tower top, so no helicopter/tower interaction is modelled.
6. **A trooper dropped directly over the tower is impossible** — the drop zone
   excludes a 40 px band around the tower centre, which sidesteps the question
   of what a trooper landing on the roof would do.
7. **Fixed canvas size.** 640×420, not responsive; consistent with the other
   games in this repo and it keeps the collision constants meaningful.
