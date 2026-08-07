# Marble Chain — Design

## Concept

Marble Chain is a spiral marble shooter in the tradition of *Puzz Loop* / *Zuma*.
A chain of coloured marbles crawls along a spiral track towards a hole in the
middle of the board. The player sits at the centre of the spiral in a rotating
shooter and fires marbles into the chain. Three or more marbles of the same
colour touching each other pop; the marbles behind snap forward to close the
gap, which can trigger a chain of combos. Clear the level's entire supply of
marbles before the head of the chain reaches the hole.

It fills a gap in this repo: Bubble Shooter is a static grid of bubbles, while
Marble Chain is about a *moving* chain and inserting into a one-dimensional
sequence under time pressure.

## Mechanics

- **The board** is a 720×520 canvas. The track is an Archimedean spiral,
  flattened vertically (`Y_SQUASH`) so it fills the landscape canvas: 3.8 turns
  from radius 330 down to radius 92, sampled into a polyline of 1400 points.
  Cumulative arc lengths turn "distance along the track" into an `(x, y)`.
- **The chain** is modelled as one rigid train. `chain` is an array of marble
  colours ordered head-first (index 0 is nearest the hole) and `headDist` is how
  far the head has crawled, so marble `i` always sits at
  `headDist - i * SPACING`. There is no per-segment physics — see *Assumptions*.
- **Feeding.** Each level has a supply of `LEVEL_SUPPLY` (52) marbles. Marbles
  join the *tail* whenever the tail has crawled a full marble past the track
  entrance, so the chain grows from behind until the supply is spent. If the
  chain is ever emptied while marbles remain in the supply, the next batch
  starts again from the track entrance.
- **Crawling.** `headDist` grows at `chainSpeed(level)` px/s. If the head reaches
  the end of the track (the hole) the game is over.
- **Shooting.** The shooter is fixed at the centre of the spiral and rotates. It
  holds a *current* marble and shows the *next* one; firing launches the current
  marble at `SHOT_SPEED` along the aim, promotes next → current, and draws a new
  next. Up to `MAX_SHOTS` (3) marbles can be in flight. Loaded colours are
  always drawn from the colours still on the track, so the player is never given
  a marble that cannot possibly match.
- **Insertion.** A shot that comes within one marble diameter of a chain marble
  lands. The nearest chain marble `j` is found, the shot's position is projected
  onto the track to get its own distance `d`, and the marble is spliced in
  *ahead* of `j` if `d > dist(j)` and *behind* it otherwise. Because positions
  are derived from the index, everything behind the insertion point shifts one
  spacing further back — the chain grows backwards, never forwards.
  Shots are integrated in sub-steps small relative to the marble radius, so a
  fast shot can never tunnel through the chain.
- **Matching.** After an insertion, the run of same-coloured marbles around the
  new marble is measured. Three or more pop. Because the chain is rigid, the
  gap closes instantly, so the junction left behind is re-checked: if it also
  forms a run of three the pops continue as a **combo**, and each successive pop
  in the cascade is worth progressively more.
- **Scoring.** A pop scores `10 × runLength × level × comboIndex`. The best score
  is persisted in `localStorage` under `marble-chain-best`.
- **Levels.** A level is cleared when the supply is exhausted *and* the track is
  empty. The score carries over; the next level crawls faster and uses more
  colours. Losing resets to level 1.

### Difficulty scaling (pure functions of `level`)

| Quantity        | Formula                                             |
|-----------------|-----------------------------------------------------|
| `chainSpeed`    | `CHAIN_BASE + (level-1) * CHAIN_STEP` (30, +6 px/s) |
| `levelColors`   | first `min(6, 3 + floor((level-1)/2))` of `COLORS`  |
| points per pop  | `10 × run × level × combo`                          |

## Controls

| Input | Action |
|---|---|
| Mouse move | Aim the shooter at the pointer |
| ← / → | Rotate the aim (hold to sweep) |
| Click | Aim at the pointer and shoot |
| Space | Start / restart, or shoot while playing |
| S | Swap the current and next marbles |
| P | Pause / resume |

## Code structure

`game.js` is a single classic (non-module) script, matching Kaboom, Snake and
Tetris in this repo, so every piece of state and logic is reachable from the
Playwright tests as a plain global.

| Area | Pieces |
|---|---|
| Track | `buildPath()`, `pathPoint(d)`, `nearestPathDist(x, y, around)`, `pathLength`, `hole` |
| Chain | `chain`, `headDist`, `marbleDist(i)`, `marblePos(i)`, `feedChain()`, `setChain()` |
| Shooting | `shooter`, `shots`, `fire()`, `swapMarbles()`, `aimAt()`, `setAim()`, `updateShots()` |
| Matching | `insertAt(index, color)`, `resolveMatches(index)`, `lastCombo` |
| Flow | `startGame()`, `startLevel()`, `togglePause()`, `levelCleared()`, `gameOver()` |
| Rendering | `draw()` and its `drawTrack/Hole/Chain/Shots/Particles/Shooter` helpers |

All motion is expressed per-second and advanced through a single `step(dt)`, so
tests simulate frames deterministically (`for (…) step(1/60)`) instead of
depending on `requestAnimationFrame` wall-clock timing. `requestAnimationFrame`
only supplies `dt` and calls `draw()`.

`setChain(colors, head, supply = 0)` replaces the chain outright and sets how
many marbles are still queued behind it. `startLevel()` uses it to reset the
board; the tests use it to build an exact board, and because the supply defaults
to zero a hand-built chain stays exactly as given.

## Testing

`tests/marble-chain.spec.js` holds 55 Playwright tests covering: the idle screen
and HUD, the geometry of the spiral, starting and level progression, chain
crawling and feeding, aiming/firing/swapping, insertion on the correct side,
pops, combos, level clear, game over, best-score persistence, and that the
render loop paints without throwing.

## Assumptions

The task left several details open. These are the calls that were made, always
taking the simpler interpretation:

1. **Branch name.** The scheduled prompt asked for a branch named after the game
   (`marble-chain`), but the session's standing instruction pins development to
   `claude/loving-euler-7ol2ex`, and pushing elsewhere is forbidden without
   explicit permission. The standing instruction wins; the game name lives in
   the folder, docs and commits instead.
2. **Rigid chain.** Real Zuma splits the chain into segments that collide and
   push each other. Here the chain is one rigid train: a pop closes its gap
   instantly. This keeps the model to "an array plus one distance", makes combos
   fall out naturally, and is fully deterministic for tests. The cost is that
   there is no "pull back" reward animation after a pop.
3. **Insertions grow backwards.** Splicing a marble in never pushes the head
   closer to the hole; the tail extends instead. Being shot at therefore never
   directly loses you the game. Marbles pushed back past the track entrance
   simply are not drawn until they crawl on again.
4. **No power-ups.** No bombs, colour-change or slow-down marbles — the classic
   version's extras are omitted rather than half-implemented.
5. **Randomness.** Plain `Math.random()`, no seeded PRNG. Tests that need an
   exact board build it with `setChain()` instead of seeding.
6. **Emptying the track mid-level** restarts the remaining supply from the track
   entrance rather than continuing from where the old chain was.
7. **"Left" in the HUD** counts marbles still waiting to enter the track, not
   marbles currently visible.
8. **Level supply and speeds** (52 marbles, 30 px/s +6 per level, 3 colours
   growing to 6) were tuned by bot-playing level 1: a naive auto-player clears
   it in roughly 22 seconds, and an idle player loses in about 150.
