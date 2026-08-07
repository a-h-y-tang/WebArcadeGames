# Marble Spiral — Design

## Concept

Marble Spiral is a marble-shooter in the tradition of *Puzz Loop* / *Zuma*. A
chain of coloured marbles crawls along a spiral groove towards a pit at the
centre of the board. A turret sits in the middle of the spiral; the player aims
it with the mouse and fires marbles into the chain. Three or more marbles of the
same colour touching each other pop, and a pop that joins two matching groups
sets off a chain reaction worth extra points.

Clear every marble in the level before the leading marble reaches the pit. Each
level sends a longer, faster chain drawn from a wider palette.

It is distinct from the repo's existing Bubble Shooter: there the board is a
static hex grid, here the target is a single moving chain on a curve, and
insertion position (not grid snapping) is what the player is judging.

## Mechanics

### The path

The spiral is defined parametrically — radius interpolates from `SPIRAL_R_OUT`
(212 px) down to `SPIRAL_R_IN` (96 px) over `SPIRAL_TURNS` (2.25) turns — and
sampled once at startup into a polyline with a **cumulative arc-length table**.
That makes the path arc-length parameterised: `pathPoint(d)` returns the point
exactly `d` pixels along the groove (clamped at both ends), so marble spacing is
uniform no matter how tightly the spiral curves. `nearestPathDist(x, y)` runs the
mapping backwards — it finds the distance-along-path of the sample nearest a
point — and is what decides where an incoming shot belongs.

The path start (outer end) is where new marbles feed in; the path end is the
**pit**, drawn as a dark hole with a red rim.

### The chain

The chain is **rigid**: marble `i` always sits exactly `i * BALL_SPACING` behind
the leader, so the only state needed is the marble list plus `chainFront`, the
leader's distance along the path. Inserting or popping marbles re-packs the whole
chain for free, with no per-marble physics and no gaps to close.

- **Advance.** Every frame `chainFront` grows by `chainSpeed(level)` px/s.
- **Feeding.** Queued marbles (`pending`) are appended to the tail as soon as
  there is room on the path for them (`chainFront - chain.length * BALL_SPACING
  >= 0`), so the chain trickles in from the outer end rather than appearing at
  once.
- **Losing.** When `chainFront` reaches the path length the leader has fallen
  into the pit and the game ends.

### Shooting

The turret is fixed at the spiral's centre and rotates to face the mouse.
Clicking fires the loaded marble at `SHOT_SPEED` along that heading, subject to a
`SHOT_COOLDOWN`; the "next" marble slides into the barrel and a new one is drawn.
<kbd>Space</kbd> swaps the loaded and next marbles.

To keep the player from being handed a dead colour, the reload prefers (85 % of
the time) a colour that is still present in the chain.

### Insertion and matching

A shot that comes within `BALL_R * 2` of any on-path chain marble joins the
chain. Its index is computed from `nearestPathDist` — marbles are ordered by
decreasing distance, so the newcomer goes in front of the first marble that is
further from the pit than it is. Insertion extends the **tail** backwards rather
than pushing the leader forward, so shooting normally costs the player no ground.
The one exception is a full groove: if the tail would hang off the back of the
path, `clampChainToPath` slides the whole chain forward until the last marble is
back on it, which is what makes a badly-packed board dangerous.

`resolveMatches` then pops the run containing the new marble if it is at least
`MIN_MATCH` (3) long, and keeps popping while the join left behind by the last
pop is itself a match — that is the chain reaction. Each successive pop in a
cascade multiplies its score, and every pop shoves the chain **back** from the
pit by `POP_PUSHBACK` px per marble, which is the player's only way of buying
time.

### Levels and scoring

- Popping scores `POP_POINTS` (10) per marble × the combo step (1 for the first
  pop of a cascade, 2 for the second, …).
- Emptying the chain with the queue exhausted completes the level: `LEVEL_BONUS`
  (250) points, then the next level starts immediately with a fresh chain.
- The best score is persisted in `localStorage` under `marble-spiral-best`.

### Difficulty scaling (all pure functions of `level`)

| Quantity              | Formula                                    | Level 1 |
|-----------------------|--------------------------------------------|---------|
| `levelBallCount(l)`   | `min(70, 34 + (l - 1) * 6)`                | 34      |
| `chainSpeed(l)`       | `26 + (l - 1) * 5` px/s                    | 26      |
| `colorsForLevel(l)`   | `min(6, 3 + floor((l - 1) / 2))`           | 3       |

## Controls

| Input | Action |
|---|---|
| Mouse move | Aim the turret |
| Click | Fire the loaded marble |
| Space / Enter | Start the game; while playing, swap loaded ↔ next marble |
| P | Pause / resume |

## Code layout

Single classic (non-module) script, matching Kaboom, Snake and Tetris in this
repo, so state and logic are reachable from the Playwright specs as plain
globals.

- `index.html` — HUD, canvas (640 × 480), overlay, help strip.
- `style.css` — shared dark arcade look used across the repo's games.
- `game.js` — path table, chain geometry, simulation, rendering, input.
- `tests/marblespiral.spec.js` — 64 Playwright specs.

`step(dt)` advances the world in fixed `1/240 s` sub-steps so fast shots can
never tunnel through the chain and the simulation is frame-rate independent; the
tests drive `step()` directly instead of waiting on `requestAnimationFrame`.

### Test hooks

`fireTestShot(color, x, y)` places a shot of a known colour at a known point,
bypassing the cooldown, so specs can exercise insertion and matching precisely
without simulating a flight path. `ballDist(i)` / `ballPos(i)` expose chain
geometry for assertions.

## Assumptions

These were resolved without asking, taking the simpler reading each time:

1. **Rigid chain.** Real *Zuma* splits the chain into independent segments that
   collide and collapse with their own momentum. Here the chain is one rigid
   train that re-packs instantly. It keeps the model to two variables and is
   still faithful to the core decision the player makes.
2. **One life.** The leader reaching the pit ends the run outright; there are no
   spare lives, and the score/level reached is the result.
3. **No power-ups.** No bombs, colour-swap or slow-down pickups — plain marbles
   only.
4. **Insertion pushes the tail, not the leader** — except when the groove is
   already full, where the chain slides forward instead of hanging off the back
   of the path. Marbles the player is responsible for therefore stay visible.
5. **Pops push the chain back** by a flat `POP_PUSHBACK` per marble. That is the
   simplest stand-in for *Zuma*'s recoil physics and gives popping a tangible
   defensive payoff.
6. **Branch name.** The task asked for a branch named after the game
   (`marble-spiral`), but this session is required to develop on
   `claude/loving-euler-m9q0fo`; the designated branch wins, and the folder and
   assets carry the game's name instead.
7. **Level clearing is detected on a pop**, not as a standing "chain empty"
   check, so a level advances only as the result of the player's shot.
8. **Level length is capped** at `COUNT_MAX` (70 marbles, ~77 % of the groove)
   so that deep levels stay beatable rather than spawning a chain longer than
   the path itself.

## Verification

Besides the specs, a scripted bot (aim at a marble matching the loaded colour,
fire every quarter second) plays the game headlessly for five simulated minutes:
it clears six levels and scores ~17 000 before losing on level 7, with no page
errors. That confirms the level progression is winnable and that difficulty
eventually catches up with the player.
