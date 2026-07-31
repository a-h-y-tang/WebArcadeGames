# Marble Chain — Design

## Concept

A spiral-track marble shooter in the Zuma tradition. A chain of coloured
marbles crawls along a spiral groove towards a pit at its centre. The player
sits in the middle of the spiral behind a launcher and fires marbles into the
chain; three or more of a colour in a row pop. Clear the whole chain to finish
the level; let a marble reach the pit and you lose a life.

Everything is drawn on a single 720×480 `<canvas>`; there is no build step and
no dependency beyond the browser.

## Mechanics

### The track

The track is an inward Archimedean spiral (2.25 turns, radius 200 → 72,
horizontally stretched 1.45× so it fills the wider canvas). At load time the
spiral is sampled densely and then **resampled at a constant 2px of arc
length**, giving an array `PATH` where index × 2 is the distance travelled.

That makes the whole game one-dimensional: a marble on the track is just
`{ color, dist }`, and `pathPoint(dist)` interpolates between two samples to get
its screen position. `nearestDist(x, y)` does the reverse — it maps a free
canvas point (a flying marble) back to the closest distance along the track.

### The chain

`balls` is kept **front-first**: `balls[0]` is closest to the pit and distances
decrease monotonically down the array. Each tick:

- the head advances at `chainSpeedFor(level)` px/s (24 + 6 per level);
- every follower moves at up to `CATCHUP` (3×) that speed, but is clamped to
  `previous.dist - SPACING`.

The clamp is the whole physics model: it keeps marbles exactly one diameter
apart, pushes them back if an insertion crowds them, and lets a trailing group
close a gap left by a pop without any extra bookkeeping.

A level spawns 28 + 4 per level marbles (capped at 46) with the head part way
down the track and the tail at negative distances, so the chain streams in from
the entrance. Spawn colours never contain a free run of three.

### Firing and landing

`shoot()` pushes a marble with velocity `SHOT_SPEED` along the launcher angle
and promotes the on-deck marble; a `SHOOT_COOLDOWN` of 0.14s throttles fire
rate. Flying marbles are integrated in ≤6px sub-steps so a fast marble cannot
tunnel through the chain. When one comes within `SPACING` of a chain marble it
lands: `landShot(nearestDist(...), color)` inserts it at the first index whose
distance is smaller, then re-applies the spacing clamp forwards down the chain.

### Matching and combos

`resolveMatches(index)` expands left and right from the inserted marble while
the colour matches. A run of three or more is removed and scores
`run × 10 × combo`. Removing a run can bring two like-coloured groups together,
so if the marbles either side of the gap now match, the scan repeats from that
junction with `combo` incremented — that is the chain reaction, and it is what
makes a well-placed shot worth far more than a plain triple.

### Winning and losing

- Track empty **and** nothing in flight → level clear, bonus `100 × level`,
  then Space starts the next (longer, faster, more colours) level.
- `balls[0].dist >= PATH_LEN` → the pit swallows a marble: lose a life and the
  chain respawns for the same level. At zero lives the game ends and the score
  is written to `localStorage` under `marblechain-best`.

## Controls

| Input | Action |
|---|---|
| Mouse move | Aim the launcher |
| Click / `Space` | Fire |
| `←` `→` | Fine aim |
| `X` | Swap the loaded and on-deck marble |
| `P` | Pause / resume |
| `Space` | Start, advance a cleared level, restart after game over |

## Code layout

| File | Contents |
|---|---|
| `index.html` | HUD, canvas, overlay, help text |
| `style.css` | Layout and the dark arcade theme |
| `game.js` | Track construction, simulation, rendering, input |
| `tests/marblechain.spec.js` | 65 Playwright tests |

`game.js` is a classic (non-module) script, so its top-level bindings —
`state`, `balls`, `shots`, `launcher`, `step()`, `landShot()`, `setChain()` — are
reachable from `page.evaluate()`. Tests drive the simulation directly with
`step(dt)` instead of waiting on the animation loop, which keeps them fast and
deterministic; the `requestAnimationFrame` loop only calls `step()` while the
state is `running`, so the same entry point serves both.

## Assumptions

The task left some points open; these are the choices made, always the simpler
reading:

- **Branch name.** The task asked for a branch named after the game, but this
  session is assigned the branch `claude/loving-euler-j4ggbu` and is instructed
  never to push elsewhere. The assigned branch wins; the folder and game name
  carry the identity instead.
- **No pushback on a pop.** In the arcade original, clearing a run shoves the
  trailing section backwards. Here the trailing marbles simply catch up into the
  gap. Simpler, and it keeps level pacing predictable.
- **No forward "collapse bonus" rollback.** Only the junction created by a
  collapse is re-checked, not the whole chain.
- **One chain per level.** No second wave joins mid-level; a level is over when
  the track is empty.
- **Losing a life respawns the level chain** rather than ending the run, so
  three lives give three attempts at the same level.
- **Colours are random per spawn** (`Math.random`), with a guard against
  spawning a free run of three. Tests never depend on the randomness — they
  build exact chains with `setChain()`.
- **Insertion side** is decided purely by the flying marble's nearest track
  distance rather than by which face of the target marble was struck.
