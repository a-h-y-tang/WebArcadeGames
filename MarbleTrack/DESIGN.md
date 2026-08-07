# Marble Track — Design

## Concept

Marble Track is a marble-shooter in the spirit of *Puzz Loop* / *Zuma*. A chain
of coloured marbles rolls along a spiral track toward the hole at its centre.
The player sits in the middle of the spiral on a turret that fires marbles
outward. Landing three or more of a colour in a row pops them; the marbles
behind the gap roll forward to close it, and if the two ends that meet share a
colour they pop as well — a cascade that pays a rising combo multiplier.

Clear every marble in the level's queue before the head of the chain reaches
the hole. Each cleared level rolls out a longer, faster chain and, every other
level, an extra colour.

## Mechanics

- **The board** is a 640×480 canvas. The track is an Archimedean spiral of 2.5
  turns running from radius 205 (the entrance, on the right) down to radius 58
  (the hole). The shooter is fixed at the centre of the spiral and can aim
  through a full 360°.
- **One-dimensional chain.** Marbles are stored as a flat array of colours plus
  a single scalar `headT` — the distance along the track of the marble nearest
  the hole. Marble *i* therefore sits at `headT - i * SPACING`, and the whole
  chain is a rigid packed line. Rendering converts that distance to a canvas
  point with `pointAt(t)`.
- **Rolling.** While marbles are on the track, `headT` grows at
  `speedForLevel(level)` pixels per second. When `headT` reaches the end of the
  track the head drops into the hole and the game is over.
- **The queue.** Each level starts with `marblesForLevel(level)` marbles waiting
  off-track. A new marble is appended to the back of the chain whenever there is
  a full diameter of clear track behind it. Queued colours come from the level
  palette, biased toward repeating the marble behind them so the chain arrives
  in *pairs* — but never in ready-made runs of three, because the third marble
  of a run is the player's shot to make.
- **Shooting.** A click fires the loaded marble from the centre at
  `SHOT_SPEED` px/s toward the pointer. Only one marble may be in flight at a
  time; a shot that touches nothing leaves the canvas and is discarded. Space
  (or right-click) swaps the loaded marble with the one queued behind it.
- **Insertion.** A shot that comes within one diameter of a chain marble is
  absorbed. The side it lands on is decided by comparing its distance to the two
  points half a diameter ahead of and behind that marble on the track. Insertion
  *wedges the chain apart*: everything ahead of the new marble is shoved one
  diameter closer to the hole (`headT += SPACING`), while the marbles behind it
  keep their positions.
- **Matching.** After an insertion the run containing the new marble is measured;
  a run of `MATCH_MIN` (3) or more pops. Then the marbles that have just become
  neighbours across the gap are compared, and if they match the cascade
  continues. Each pop in a cascade is worth `run × 10 × comboIndex` points, so a
  two-stage cascade pays far more than the same marbles cleared separately.
  `lastCombo` records how many pops the shot produced.
- **Closing the gap.** Marbles behind a popped run roll forward into it, which is
  why `headT` is left alone for a pop that happens behind the head. If the head
  itself was popped there is nothing ahead to roll into, so the whole chain is
  pulled *back* from the hole by the length of the run instead.
- **Levels.** Emptying the track with an empty queue clears the level, awards
  `100 × level` points, and starts the next one with a longer, faster chain.
  Emptying the track while marbles are still queued does not: the queue simply
  starts feeding a fresh chain from the entrance.
- **Scoring.** The best score is persisted in `localStorage` under
  `marble-track-best`.

### Difficulty scaling (pure functions of `level`)

| Quantity            | Formula                                     | Level 1 |
|---------------------|---------------------------------------------|---------|
| chain speed (px/s)  | `26 + (level-1) * 5`                        | 26      |
| marbles in the level| `34 + (level-1) * 6`                        | 34      |
| colours in play     | `min(3 + floor((level-1)/2), 5)`            | 3       |
| level clear bonus   | `100 * level`                               | 100     |

Because these are pure functions of `level`, the simulation is fully
deterministic given the level, the chain contents and the player's shots — which
is what makes the Playwright tests reliable.

## Controls

| Input        | Action                                  |
|--------------|-----------------------------------------|
| Mouse move   | Aim the shooter                         |
| Click        | Fire the loaded marble                  |
| Space        | Start / restart, or swap loaded ↔ next  |
| Right-click  | Swap loaded ↔ next                      |
| P            | Pause / resume                          |

## Code structure

Everything is plain, dependency-free, non-module JavaScript so the state and the
logic are reachable from Playwright as globals — the same shape as Kaboom, Dino
Run and Tetris in this repo.

| File        | Contents                                                   |
|-------------|------------------------------------------------------------|
| `index.html`| HUD, canvas, overlay and help text                         |
| `style.css` | Presentation only — no layout is computed in JS            |
| `game.js`   | Track geometry, simulation, rendering and input            |

Inside `game.js`:

- **Track geometry** — `buildSpiral()` samples the spiral once at load,
  `buildArcLengths()` turns it into a cumulative arc-length table and
  `pointAt(t)` binary-searches that table so `t` is a true arc length (points 20
  px apart in `t` are 20 px apart on screen). `pointAt` clamps outside the track.
- **State** — `state`, `score`, `best`, `level`, `pending`, `headT`, `chain`,
  `shot`, `shooterColor`, `nextColor`, `lastCombo`, declared with `var` so the
  tests can read *and* assign them.
- **Simulation** — `step(dt)` advances the chain, feeds the queue, moves the shot
  and its collisions, ages particles, then checks for a lost or cleared level.
  Nothing moves unless `state === 'running'`.
- **Chain surgery** — `insertMarble(index, color)`, `resolveMatches(index)` and
  `popRun(start, count)`.
- **Rendering** — `draw()` and its helpers; drawing reads state but never
  mutates it, so tests can drive the simulation without rendering mattering.

## Determinism & testing

`step(dt)` takes the timestep as an argument and the render loop is the only
caller that uses wall-clock time, so tests advance the game by calling
`step(0.016)` in a loop. Tests can also install an exact board with the
`setChain(colors, headT)` helper, which replaces the track contents and empties
the queue so nothing spawns underneath an assertion.

Randomness is confined to `rollColor()` (what the shooter loads) and
`queueColor()` (what rolls onto the track). Tests never depend on either: they
assign `shooterColor` directly, or assert properties that hold for *every* draw
(only palette colours arrive, runs of three never arrive pre-made, the shooter
only offers colours still on the track).

The suite in `tests/marbletrack.spec.js` covers the initial and idle state,
track geometry, starting and queueing, chain motion, the shooter, insertion,
matching and cascades, level progression, losing, pausing and restarting.

## Assumptions

These are the judgement calls made where the brief was open-ended; each took the
simpler reading.

1. **Branch name.** The task asked for a branch named after the game
   (`marble-track`), but this session is pinned to the branch
   `claude/loving-euler-968rmx`. The pinned branch wins; the game name lives in
   the folder, the commit and the PR title instead.
2. **Rigid chain, no slack.** Real Zuma models each contiguous run of marbles as
   a separate segment that rolls forward independently after a pop. Here the
   chain is one rigid line: a pop closes instantly and the following marbles are
   already in place. This keeps positions derivable from a single `headT` and
   makes the cascade rules exact rather than timing-dependent.
3. **Insertion pushes forward.** With no slack in the chain, an insertion has to
   displace something; it shoves the marbles *ahead* of the new one toward the
   hole. That matches the pressure the player feels in the original and keeps the
   marbles behind the insertion point still.
4. **One life, no marble-back.** There are no lives and no power-ups (no
   accuracy laser, no reverse, no bombs). One marble in the hole ends the run.
5. **Colours are names, not indices.** Marbles store `'red'`, `'blue'`, … and a
   lookup table maps those to hex, which keeps the tests readable.
6. **A cleared track with marbles still queued is not a cleared level.** The
   queue simply starts a new chain from the entrance.
