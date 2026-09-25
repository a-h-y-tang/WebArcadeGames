# Peg Pop — Design

## Game concept

Peg Pop is a single-screen physics game. A launcher sits at the top of the
playfield and fires a small steel ball down into a field of pegs. The ball is
pulled by gravity and ricochets off every peg it touches, so a single shot can
carom across the board and clear far more than the peg it was aimed at.

Every board hides a set of **orange target pegs** among the plain blue ones.
Clearing *all* of the orange pegs finishes the level; the blue pegs are there
for points and, more importantly, as bumpers to steer the ball into the oranges.
A single **green peg** on each board rewards a hit with an extra ball. A
**free-ball bucket** slides back and forth along the bottom of the playfield —
drop the ball into it instead of letting it fall past, and the ball is returned.

Ten balls per level, five levels, one score. Running out of balls with orange
pegs still standing ends the run, and the best score is remembered between
sessions.

## Playfield and geometry

| Constant | Value | Meaning |
|---|---|---|
| `W` × `H` | 480 × 640 | canvas size in CSS pixels |
| `BALL_R` | 6 | ball radius |
| `PEG_R` | 9 | peg radius |
| `LAUNCH_SPEED` | 230 px/s | muzzle speed of a fired ball |
| `GRAVITY` | 520 px/s² | downward acceleration |
| `PEG_BOUNCE` | 0.72 | restitution against a peg |
| `WALL_BOUNCE` | 0.85 | restitution against a wall |
| `AIM_LIMIT` | 1.2 rad | maximum tilt either side of straight down |
| `BALLS_PER_LEVEL` | 10 | balls granted at the start of each level |
| `LEVEL_COUNT` | 5 | levels in a full run |
| `SHOT_TIME_LIMIT` | 20 s | simulated-time cap on one shot |

The launcher is fixed at `(W / 2, 40)`. Aim is stored as `launcher.angle`, an
angle in radians where `0` is straight down, negative tilts left and positive
tilts right; the fire direction is therefore `(sin angle, cos angle)`. Pegs live
in the band `y ∈ [170, 520]`, clear of both the launcher and the bucket lane at
`y = 616`.

## Mechanics

### Shot lifecycle

`state` is one of `idle`, `running`, `paused`, `levelclear`, `gameover`, `won`.
While `running`, `ball === null` means the player is aiming; firing consumes one
ball and creates the ball object. A shot ends when the ball falls past the
bottom of the canvas, is caught by the bucket, or exceeds `SHOT_TIME_LIMIT`
seconds of simulated flight (a safety valve so a freak orbit can never wedge the
game). At the end of every shot the game asks, in order:

1. no orange pegs left → `levelclear` (or `won` after level 5),
2. no balls left → `gameover`,
3. otherwise back to aiming.

### Collisions

The simulation runs on a fixed `1/120 s` timestep; `physicsStep(dt)` integrates
aim, bucket and ball, so the result of a shot depends only on the aim it was
fired with, never on frame rate. Peg collisions are resolved one peg at a time:
when the centres are closer than `BALL_R + PEG_R`, the ball is pushed back out
along the contact normal and its velocity is reflected about that normal and
scaled by `PEG_BOUNCE`. Side and top walls reflect the relevant velocity
component and scale it by `WALL_BOUNCE`; the bottom edge is open.

### Scoring

| Event | Points |
|---|---|
| Blue peg | 10 |
| Green peg | 50, plus one extra ball |
| Orange peg | 100 |
| Level cleared | 250 × balls still in hand |

The best score is written to `localStorage` under `pegpop-best` when a run ends
(game over or victory) and is loaded on page load.

### Boards

Board layouts are hand-authored patterns (grid, arch, diamond, zigzag, rings)
built by `buildLevel(n)`, with peg *types* assigned by a fixed rule rather than
at random: every `orangeStride`-th peg is orange and the middle peg of the
pattern is the green one. The stride tightens on later levels (6, 5, 5, 4, 4),
so later boards carry more targets. Because nothing is random, a given level is
always the same board, which keeps the Playwright suite deterministic.

## Controls

| Input | Action |
|---|---|
| `←` / `→`, `A` / `D` | swing the launcher (tap nudges, hold sweeps) |
| Mouse move over the canvas | aim at the pointer |
| `Space`, click | start / fire / dismiss an overlay |
| `P` | pause and unpause |
| Start button | start, or continue from an overlay |

## Code layout

- `index.html` — HUD (`#score`, `#level`, `#balls`, `#pegs`, `#best`), the
  `#canvas`, the `#overlay` and its Start button, and a control legend.
- `style.css` — dark cabinet styling shared in spirit with the other games here.
- `game.js` — one classic script, no modules or build step. Globals (`state`,
  `score`, `level`, `ballsLeft`, `pegs`, `ball`, `launcher`, `bucket`) and the
  functions that drive them (`startGame`, `fireBall`, `physicsStep`,
  `orangesLeft`, `advance`, `setAim`, `aimBy`, `togglePause`) are deliberately
  top-level so the Playwright suite can drive the simulation directly.
- `tests/peg-pop.spec.js` — the Playwright suite, written before the game.

## Assumptions

Decisions taken without asking, resolved toward the simpler reading:

1. **Branching.** Development happened on the game-named branch `peg-pop` as the
   task asked, but the commits are pushed to this session's designated remote
   branch `claude/compassionate-ramanujan-jiewnj`, which the session rules pin.
2. **Pegs disappear on contact** rather than lighting up and clearing at the end
   of the shot as in the arcade games this borrows from. Immediate removal is
   simpler, cannot double-count a hit, and makes a shot easy to reason about.
3. **No score multiplier** for long combos. Fixed peg values keep the scoring
   readable; the level-clear bonus already rewards efficient play.
4. **Hand-authored boards, no random generation**, and no procedural levels past
   level 5 — a finished run shows a victory screen instead of looping forever.
5. **Balls reset to ten on every level** rather than carrying a surplus over;
   the surplus is converted into the level-clear bonus instead.
6. **The bucket returns the ball but never traps it**: a caught ball simply ends
   the shot and refunds a ball, with no bonus points.
7. **`autoRun` test hook.** The animation loop only advances the simulation while
   the global `autoRun` is true. The game never changes it, but the test suite
   sets it to `false` to place a ball by hand and step physics deterministically.
8. **Canvas is fixed at 480 × 640** with no responsive scaling, matching the
   fixed-size canvases used by the other games in this repo.
