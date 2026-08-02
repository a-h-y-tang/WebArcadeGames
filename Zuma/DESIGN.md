# Zuma — Design

A marble-shooter arcade game on an HTML5 canvas. A chain of coloured marbles
crawls along a winding track toward a skull-hole at the end. A launcher in the
middle of the play field fires marbles into the chain; three or more of the same
colour touching each other pop. Clear the whole chain before it reaches the hole.

## Game concept

- The track is a fixed serpentine curve that enters off-screen on the left,
  sweeps across the field three times, and terminates in a **skull hole** on the
  right. Reaching the hole ends the run.
- Marbles feed onto the back of the track one at a time from a per-level
  **spawn queue** and shuffle forward as a single packed chain.
- The player controls a **launcher** at the bottom-centre of the field holding a
  *current* marble and a *next* marble. Fired marbles fly in a straight line and
  **insert** themselves into the chain wherever they touch it.
- An insertion that creates a run of **3 or more** same-coloured marbles removes
  that run. If the marbles left on either side of the gap are the same colour and
  together form another run of 3+, that pops too — a **combo**, worth more points.
- A level is cleared when the spawn queue is empty *and* the track is empty.
  Clearing a level awards a bonus and starts the next, harder level.

## Mechanics

### The track

`PATH_POINTS` is a short list of control points. At load time they are smoothed
with a Catmull–Rom spline and resampled into a dense polyline (`path`), with a
cumulative arc-length table. Two helpers do all the geometry work:

- `pathPoint(d)` → `{x, y}` at arc-length `d` along the track.
- `pathAngle(d)` → tangent direction at `d` (used for orienting insertions).

Distances below `0` are legal: they map to the first control point, which sits
off-canvas, so marbles visibly slide in from the left edge.

### The chain

`marbles` is an array ordered **front-first** — index `0` is the marble closest
to the hole, and `dist` decreases monotonically along the array. Each frame:

1. Every marble advances by `speed * dt` (speed rises with the level).
2. A *collapse* pass walks the array front-to-back and pulls any marble that has
   fallen more than `MARBLE_SPACING` behind its neighbour forward at
   `COLLAPSE_SPEED`, so gaps left by pops close up smoothly.
3. If the queue still has marbles and the tail has advanced past `0`, the next
   queued marble is appended at `tail.dist - MARBLE_SPACING`.

Game over fires when `marbles[0].dist >= PATH_LENGTH`.

### Shooting and insertion

`shoot()` spawns a projectile travelling at `PROJECTILE_SPEED` along the aim
angle and promotes the *next* marble to *current*. Only one projectile is in
flight at a time. Each update step the projectile is tested against every chain
marble; on contact within `MARBLE_R * 2` it is inserted:

- The hit marble's index `i` and the sign of the projectile's offset along the
  local path tangent decide whether the new marble lands at index `i` (ahead) or
  `i + 1` (behind).
- The new marble takes the slot's distance and **everything behind it is pushed
  back** by one `MARBLE_SPACING` to make room. The front of the chain never jumps
  forward on an insertion, so a shot can't cause a game over.
- `resolveMatches(k)` then expands outward from `k` while the colour matches. A
  run of 3+ is removed for `MATCH_POINTS × runLength × comboMultiplier`, and the
  two marbles that end up adjacent across the new gap are re-checked immediately
  for a chain reaction.

The launcher only ever loads colours that are still present in the chain (or the
queue), so a level can't become unwinnable.

### Levels and scoring

| Quantity | Formula |
|---|---|
| Colours in play | `min(3 + level, 6)` |
| Marbles in queue | `28 + 6 × level` |
| Chain speed (px/s) | `20 + 4 × level` |
| Points per popped marble | `10 × combo multiplier` |
| Level-clear bonus | `100 × level` |

Best score is persisted in `localStorage` under `zuma-best`.

## Controls

| Input | Action |
|---|---|
| Mouse move | Aim the launcher |
| Left click | Fire |
| Right click | Swap current / next marble |
| <kbd>←</kbd> <kbd>→</kbd> | Rotate aim |
| <kbd>Space</kbd> | Start game / fire |
| <kbd>S</kbd> | Swap current / next marble |
| <kbd>P</kbd> | Pause / resume |
| <kbd>R</kbd> | Restart |

## Code layout

```
Zuma/
├── index.html   markup: HUD, canvas, overlay, help text
├── style.css    dark arcade theme shared in spirit with the other games
├── game.js      all game logic as plain browser globals (no modules)
└── tests/
    └── zuma.spec.js   Playwright suite (drives the exported globals)
```

`game.js` deliberately uses plain top-level `var`/`function` declarations rather
than modules or an IIFE. Every other game in this repo does the same, and it lets
the Playwright tests reach in with `page.evaluate(() => marbles.length)` instead
of scraping pixels. The functions tests rely on are `startGame`, `update(dt)`,
`shoot`, `swap`, `insertMarble`, `resolveMatches`, `pathPoint`, `pathAngle` and
`setSeed`.

Randomness goes through a seeded LCG (`setSeed` / `rnd`) so tests can pin a level
layout and get identical results every run.

## Assumptions

Decisions made without a human to ask, per the autonomous brief — the simpler
reading was taken every time:

1. **Branch name.** The brief asks for a branch named after the game
   (`zuma`), but this session is pinned to the branch `claude/loving-euler-cy2rfb`
   and told never to push elsewhere. The pinned branch wins; the game name is
   carried by the folder and commit message instead.
2. **Insertion pushes backwards.** Real Zuma shoves the front half of the chain
   forward when a marble wedges in. Here the *back* half is pushed back instead.
   It keeps the game fair (a shot can never cause a loss) and makes the
   game-over condition a pure function of elapsed time and pops.
3. **Instant chain reactions.** Combos are resolved immediately after a pop
   rather than waiting for the gap to physically close. Same outcome, far simpler
   to reason about and to test.
4. **One projectile at a time.** Avoids modelling multiple simultaneous
   insertions into the same chain region.
5. **No power-ups.** The original's bombs, slow-down and accuracy tokens are out
   of scope; scoring is combos only.
6. **Fixed track.** One hand-authored track reused at every level; difficulty
   comes from speed, colour count and queue length.
7. **`DESIGN.md` naming.** The repo README asks for a lowercase `design.md`, but
   commit `8139da9` removed the lowercase files and every recent game ships
   `DESIGN.md`. Followed the newer convention.
