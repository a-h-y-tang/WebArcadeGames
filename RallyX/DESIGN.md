# Rally-X — Design

## Concept

Rally-X is a top-down maze chase. You drive a blue rally car through a scrolling
maze, collecting all ten checkpoint flags before your fuel runs dry, while red
pursuit cars hunt you down. Your only weapon is the smoke screen: a puff of
exhaust dropped behind the car that spins out any pursuer that drives into it.

The maze is bigger than the window, so the view scrolls with the car and a radar
panel next to the play field shows the whole level — flags, pursuers and your own
position — at a glance.

## Board and world

| Thing | Value |
|---|---|
| Tile size | 32 px |
| Maze | 20 columns × 16 rows (640 × 512 px world) |
| Viewport | 560 × 460 canvas, camera clamped to the world |
| Radar | 160 × 128 canvas, the world at 1/4 scale |
| Flags per level | 10 (one of them is the *lucky flag*) |
| Lives | 3 |
| Fuel | 100 units, draining 2 units/second (a 50 second tank) |

### Maze generation

Each level's maze is generated deterministically from the level number, so a
given level always looks the same and the Playwright specs can rely on it:

1. Walls line the border.
2. A lattice of single-tile pillars is placed on every even row/column, which by
   construction leaves every odd/odd tile open and the whole interior connected.
3. Each pillar is then grown by one tile in a pseudo-random direction. A growth
   is kept only if a flood fill still reaches every open tile, so the maze always
   stays fully connected and never traps a flag behind a wall.

The random source is a seeded `mulberry32` generator (`seed = level * 7919 + 13`),
so nothing in the simulation depends on `Math.random`.

Flags are placed on open tiles at least 6 tiles (breadth-first distance) from the
start; pursuers spawn at least 8 tiles away. One flag is picked as the lucky
flag.

## Movement model

Every car — the player and the pursuers — moves tile to tile:

```
{ r, c,        // tile currently being left
  nr, nc,      // tile being entered
  t,           // 0..1 progress between the two
  dir, want }  // current and requested direction
```

Pixel position is the interpolation of the two tile centres, so a car is always
either parked on a tile or exactly on the line between two adjacent tiles. It can
never be inside a wall.

- On arriving at a tile, the requested direction is taken if it is open,
  otherwise the current direction continues, otherwise the car stops.
- A reversal is applied immediately, mid-tile, by swapping the two tiles and
  flipping `t` — the same trick Pac-Man uses, and what makes the car feel
  responsive when a pursuer appears ahead.

Player speed is 96 px/s (3 tiles/s). Pursuers start at 74 px/s and gain 4 px/s
per level, capped at 90 px/s — always a little slower than you, so the maze and
the smoke screen decide the chase, not raw speed.

### Pursuer AI

At every tile a pursuer picks from the open neighbours, avoiding a reverse unless
it is the only way out. With probability `chaseNoise` (0.2) it takes a random
legal turn; otherwise it takes the turn that most reduces the straight-line
distance to the player. The noise keeps four cars from converging into a single
train and gives the player gaps to exploit. Tests set `chaseNoise = 0` when they
need a pure chase.

A pursuer that touches a smoke puff spins out for 2.5 seconds: it stops dead and
draws as a spinning car.

## Scoring

| Event | Points |
|---|---|
| Flag | 100 (×2 after the lucky flag) |
| Lucky flag | 100, and doubles every flag collected after it |
| Level cleared | 5 × remaining fuel |

The best score is kept in `localStorage` under `rallyx-best`.

## Controls

| Input | Action |
|---|---|
| Arrow keys / WASD | Steer |
| Space | Drop a smoke screen (costs 6 fuel) |
| P | Pause / resume |
| Enter or Space | Start, or restart after game over |

## Game states

`idle → running → (paused) → dying / levelclear → running → over`

- **dying** — a 1.2 s pause after a crash or running out of fuel, then the cars
  are placed back at their starting tiles, the tank is refilled and play resumes.
  Collected flags stay collected.
- **levelclear** — a 1.6 s pause after the last flag, then the next level's maze
  is generated, the tank is refilled and ten new flags are placed.
- **over** — no lives left. The overlay shows the final score; Space or Enter
  starts a new run.

## Code layout

Everything lives in `game.js` as a single classic (non-module) script, matching
the other games in this repo, so the Playwright specs can read and drive the
simulation through plain globals: `state`, `score`, `lives`, `level`, `fuel`,
`grid`, `player`, `enemies`, `flags`, `smokes`, `step(dt)`, `startGame()`,
`dropSmoke()`, `togglePause()`, `placeAt()` and `isWall()`.

All motion is expressed per second and advanced through `step(dt)`, so tests can
simulate frames deterministically without depending on `requestAnimationFrame`
wall-clock timing. `draw()` is a pure function of the state and never mutates it
— even the between-lives and between-levels banners come from `bannerText()`,
which is derived from the state rather than stored.

## Assumptions

These are the judgement calls made where the brief (or the arcade original) left
room, resolved toward the simpler option:

1. **Branch name.** The task asked for a branch named after the game
   (`rally-x`), but this session is also required to develop and push on its
   designated branch `claude/compassionate-ramanujan-3g4u0n`. The designated
   branch wins, since pushing anywhere else is explicitly forbidden.
2. **Running out of fuel costs a life**, rather than the arcade behaviour of
   slowing the car to a crawl. A crawling car in a maze that can no longer be
   cleared just stalls the run; losing a life keeps the game moving and the rule
   easy to test.
3. **The tank is refilled on every respawn and on every new level.** Fuel is a
   per-life timer, not a resource carried across a whole run.
4. **The lucky flag doubles later flags only** — it does not retroactively
   double flags already collected, and the multiplier resets each level.
5. **Smoke is a single puff per press**, not a continuous trail, and at most 8
   puffs may be alive at once. This keeps the fuel cost legible and bounds the
   collision work per frame.
6. **No enemy "breakthrough" rocks or bonus stages** from the original — the
   level loop is maze → flags → next maze, with pursuer count and speed the only
   difficulty knobs.
7. **One shared maze generator for all levels**; levels differ only by seed,
   pursuer count (2 + level, capped at 5) and pursuer speed.
