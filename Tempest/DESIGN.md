# Tempest — Design

## Concept

A tribute to Atari's 1981 vector classic. You pilot the **Blaster** — a claw
that rides the outer rim of a tube (the "well") viewed straight down its
throat. Enemies climb up the lanes from the depths toward you; you rotate
around the rim and fire down the lanes to destroy them before they reach the
top. Clear every enemy to dive to the next, faster level.

## The well & coordinates

The well is a **closed ring of `LANES = 16` lanes** (radial spokes) drawn in
perspective: an outer rim (near you) and a small inner ring (far away, deep
in the tube). Everything on the playfield is addressed by two numbers:

- **lane** — an integer `0 … LANES-1` around the ring. Because the well is a
  closed loop, lane arithmetic wraps (`normalizeLane`).
- **depth** — a float `0 … 1`. `depth = 1` is the outer rim (where the
  Blaster sits); `depth = 0` is the far inner ring at the centre.

`lanePoint(lane, depth)` maps a `(lane, depth)` pair to a screen point:
the radius interpolates from `R_IN` (depth 0) to `R_OUT` (depth 1) and the
angle comes from the lane index.

## Mechanics

- **The Blaster** sits on the rim at its current `lane`. Rotating moves it one
  lane at a time around the ring, wrapping past lane 0 / lane 15.
- **Firing** drops a bullet onto the Blaster's lane at the rim; bullets travel
  *inward* (depth decreasing) down the lane and vanish at the centre. At most
  `MAX_BULLETS` may be in flight at once.
- **Enemies (Flippers)** spawn at the centre (`depth 0`) on a lane and climb
  *outward* (depth increasing). A bullet on the same lane destroys a flipper
  once it has travelled in to that flipper's depth. Destroying one scores
  `POINTS_PER_ENEMY`.
- **Reaching the rim.** A flipper that climbs to `depth = 1` latches onto the
  rim and then "flips" one lane per tick toward the Blaster, chasing it around
  the ring. A rim flipper sharing the Blaster's lane costs a life.
- **Superzapper.** Once per level you may trigger the **superzapper**, which
  wipes every enemy currently in the well. It recharges each new level.
- **Lives.** You start with 3. Losing one clears the well and grants a brief
  moment of invulnerability. At 0 lives the game ends.
- **Level clear.** When a level's spawn quota is exhausted and no enemies
  remain, you earn a `LEVEL_BONUS × level` bonus and drop into the next level:
  more enemies, higher speed, superzapper recharged.

## Controls

| Key                       | Action                          |
|---------------------------|---------------------------------|
| **← / A**                 | rotate the Blaster anticlockwise |
| **→ / D**                 | rotate the Blaster clockwise     |
| **Space**                 | fire (also starts the game)      |
| **Z / Shift**             | superzapper (once per level)     |
| **P**                     | pause / resume                   |

## Rendering

The well is drawn as a neon wireframe: radial spokes from the inner ring to the
outer rim, plus the two ring outlines. The Blaster is a yellow claw straddling
its rim lane. Flippers are magenta pinwheels that grow as they climb toward
you (perspective). Bullets are bright cyan dashes. A HUD shows Score, Best,
Lives and Level.

All game-state transitions live in small, discrete, unit-testable functions
(`movePlayer`, `fire`, `moveBullets`, `spawnEnemy`, `moveEnemies`,
`checkBulletHits`, `checkPlayerHit`, `superzap`, `loseLife`, `nextLevel`).
The real-time loop only decides *when* to call them, so the game logic is
fully deterministic and driveable from Playwright.

## Assumptions

Each of these resolves an ambiguity in favour of the simpler interpretation,
per the task guidance.

- **Closed circular well only.** The arcade cycled through many well shapes
  (open lines, cups, crosses). This version uses a single closed 16-lane ring,
  which removes all edge-of-the-well special cases and keeps movement a clean
  wrapping rotation.
- **One enemy type.** Only the climbing/flipping Flipper is implemented.
  Tankers, Spikers, Fuseballs, Pulsars and the spikes they leave behind are
  out of scope for this first version.
- **Flippers chase along the rim** one lane per tick by the shortest way
  around the ring, rather than the arcade's more elaborate flip animation.
- **Enemies climb straight up their lane** (no mid-climb lane flipping), so a
  bullet on a lane reliably clears that lane — the challenge is rim pressure
  and target prioritisation, not tracking weaving enemies.
- **Losing a life clears the well** and gives brief invulnerability, rather
  than reviving you into a crowded rim.
- **Best score** is stored under the `localStorage` key `tempest-best`.
