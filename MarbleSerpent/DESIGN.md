# Marble Serpent — Design

## Concept

A serpent of coloured marbles crawls along a fixed winding track toward a pit at
the end of the path. From a cannon parked inside the track's coils the player
fires marbles into the serpent. Landing three or more of the same colour
together makes them pop; the tail then rushes forward to close the gap, and if
the colours meet up again another group pops — a chain reaction worth a
multiplied score. Clear every marble before the head reaches the pit.

This is the "path marble shooter" genre (Zuma / Luxor). It is deliberately
different from the repo's existing `BubbleShooter` (a static hex grid of bubbles)
and `Match3`/`GemMatch` (a rectangular swap grid): here the targets are a moving
one-dimensional queue, and the interesting decisions are about *where* along a
moving line to inject a colour and how to set up cascades.

## Board

- Canvas is 720 × 520, drawn with a dark board and a stone-grey track.
- The track is a serpentine path defined by 13 control points, smoothed with a
  Catmull–Rom spline and sampled into a polyline. The polyline is turned into an
  arc-length table so any distance `d` along the path maps to an `(x, y)` point
  (`pathPoint(d)`) in constant-ish time.
- The path starts off the left edge (marbles emerge from a hole) and ends at a
  pit in the lower right. `pathLength()` is the total arc length.
- The cannon sits at (300, 462), inside the lowest coil and clear of the track.

## Model

The serpent is a single array `marbles`, ordered **front first**: `marbles[0]` is
the marble nearest the pit and has the largest distance `d`. Each marble is
`{ d, color }`.

Movement each `step(dt)`:

1. `marbles[0].d += chainSpeed() * dt` — only the head crawls under its own power.
2. For every marble behind it, let `lead = marbles[i-1].d - MARBLE_SPACING`.
   - If `marbles[i].d < lead` there is a **gap**: the marble accelerates forward
     at `CATCHUP_SPEED` (much faster than the crawl), clamped at `lead`.
   - Otherwise it is locked rigidly at `lead`.

This gives the two behaviours the genre needs from one rule: a solid chain
pushes forward as one body, and a group cut loose behind a gap sprints to
rejoin.

Chain reactions hang off a **`chasing` flag**, not off geometry. When a pop
severs the serpent, the marble left at the front of the trailing group is marked
`chasing`; when it reaches its leader again the flag clears and that junction is
checked for a match. Detecting junctions geometrically does not work here:
because the head crawls forward every frame, every marble behind it is
fractionally adrift on every frame, so a "has the gap closed?" test fires
constantly — and marbles merely trailing in from the mouth would pop on their
own without the player ever shooting.

Marbles are spawned from a pre-generated `queue` of colours for the level. A new
marble always emerges at the mouth (`d = 0`), and only once the tail has cleared
`MARBLE_SPACING`, so the spawn rate follows the chain speed automatically. If
the tail has already crawled ahead, the newcomer trails behind and closes the
distance under the catch-up rule.

### Shooting and insertion

A shot is `{ x, y, vx, vy, color }` travelling in a straight line at
`SHOT_SPEED`. Each step it is tested against every marble's path position; a
centre distance below `2 * MARBLE_R` counts as a hit. The side of the hit marble
to insert on is decided by comparing the shot's position against
`pathPoint(d ± MARBLE_SPACING)` — whichever neighbouring slot is nearer wins.

`insertMarble(color, index)` splices the marble in, gives it the distance of the
slot it took, then walks the tail applying `d[j] = min(d[j], d[j-1] - SPACING)`.
The insertion therefore only ever pushes marbles **backwards**, never forwards
into the pit — this keeps the pit strictly a consequence of the crawl and makes
the danger state predictable.

### Matching

`findRun(index)` expands left and right from an index while the colour matches
*and* the neighbours are actually touching (gaps break a run). A run of
`MIN_MATCH` (3) or more is removed, scoring `count * POINTS_PER_MARBLE * combo`.

`combo` is 1 for the group the player shot, and increments for each further
group popped by a closing junction in the same cascade, so long chain reactions
are worth several times their marble count.

### Level flow

- `colorsForLevel` = `min(3 + floor((level - 1) / 2), 6)` — new colours appear
  every other level.
- `chainSpeed` = `26 + 5 * (level - 1)` px/s.
- `queueSizeForLevel` = `32 + 6 * (level - 1)` marbles.
- Clearing every marble with an empty queue advances the level and awards a
  `LEVEL_BONUS` of 200 points.
- A marble reaching the pit (`d >= pathLength()`) costs a life and restarts the
  current level's serpent. At zero lives the game ends.
- The best score is kept in `localStorage` under `marble-serpent-best`.

## Controls

| Input | Action |
|---|---|
| Mouse move | Aim the cannon |
| Click | Fire |
| ← / → | Rotate the aim (keyboard alternative) |
| Space | Start the game / fire while playing |
| S | Swap the loaded marble with the next one |
| P | Pause / resume |

## Code layout

Single classic (non-module) `game.js`, matching the other games in this repo, so
that every constant, state variable and function is a plain global the Playwright
tests can reach through `page.evaluate`. All motion is per-second and advanced by
`step(dt)`, so tests simulate frames deterministically instead of waiting on
`requestAnimationFrame`.

Key globals used by the tests: `state`, `score`, `best`, `level`, `lives`,
`marbles`, `shots`, `queue`, `shooter`, `startGame()`, `step(dt)`, `shoot()`,
`aimAt(x, y)`, `swapMarble()`, `togglePause()`, `endGame()`, `pathLength()`,
`pathPoint(d)`, `chainSpeed()`, `insertMarble(color, index)`, `findRun(index)`,
`resolveMatchAt(index)`.

## Assumptions

These were decisions the brief left open; the simpler reading was taken in each
case and is recorded here.

1. **Branch name.** The task asked for a branch named after the game
   (`marble-serpent`), but this session is pinned to the designated development
   branch `claude/loving-euler-mrlhyq` and must not push elsewhere. The work is
   therefore committed to the designated branch; the game name is carried by the
   folder and the PR title instead.
2. **No back-pressure on insertion.** In some games of this genre a marble
   inserted mid-chain shoves the front section *forward*, closer to the pit.
   Here insertion only ever pushes marbles backwards; existing marbles never
   advance because of a shot. (A marble landing ahead of the head does take the
   slot in front of it, which is the one case where the serpent's leading edge
   moves forward — there is nowhere else for it to go.)
3. **No reverse-rollback.** After a group pops, the tail catches up to the
   front; the front does not roll backwards toward the tail. One motion rule
   instead of two.
4. **A life loss restarts the level's serpent** rather than resuming a partially
   cleared one — the queue is regenerated and the board cleared, and the score
   is kept.
5. **Loaded colours are drawn from colours still in play** (chain plus unspawned
   queue), so the cannon can never hand the player a useless colour. When the
   board is completely empty the full level palette is used.
6. **The queue is uniformly random** over the level's palette, with no
   hand-authored runs or special power-up marbles (no bombs, no colour-swap
   marbles). Cascades come from player play, not from the generator.
7. **Multiple shots may be in flight at once.** There is no reload delay; the
   travel time is short enough that this is rarely exploitable.
8. **The aim is unrestricted through the full circle.** Marbles fired away from
   the track simply leave the canvas and are discarded.
