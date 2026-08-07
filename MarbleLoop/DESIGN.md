# Marble Loop — Design

## Concept

Marble Loop is a Zuma-style "marble shooter" on an HTML5 canvas. A chain of
coloured marbles crawls along a spiral track towards a hole at the centre of
the board. The player controls a launcher that sits in the middle of the
spiral, rotates it to aim, and fires marbles into the advancing chain.
Grouping three or more marbles of the same colour destroys them, shortening
the chain and buying time. Clear every marble in a level to advance; let the
head of the chain reach the hole and the game is over.

It is deliberately different from the repo's existing `BubbleShooter`, which
fires into a static hexagonal grid: here the target is a single moving,
one-dimensional chain, and the interesting decisions are about *where along
the chain* a marble lands and *when* to take a shot.

## Board geometry

The track is an Archimedean spiral, sampled once at load time into a
polyline `PATH` of points spaced ~1 px apart:

```
t  in [0, 1]
a  = t * SPIRAL_TURNS * 2π
r  = R_OUTER + (R_INNER - R_OUTER) * t
x  = CENTER.x + r * X_SCALE * cos(a)
y  = CENTER.y + r * sin(a)
```

Because the samples are evenly spaced, "distance along the path" is simply an
index into `PATH`, and `pathPoint(d)` is an O(1) lookup with clamping at both
ends. `pathLength` is the last valid distance; `PATH[0]` is where marbles
enter the board and `PATH[pathLength]` is the hole.

## The chain

The chain is stored as a **contiguous** run of marbles:

```js
chain = { head: <distance of the front marble>, colors: [front, ..., back] }
```

Marble `i` sits at distance `head - i * SPACING`. There is no per-marble
position, so:

* **Advancing** the chain is one addition: `head += chainSpeed() * dt`.
* **Inserting** a marble at index `k` is `colors.splice(k, 0, color)` — every
  marble behind `k` is automatically pushed one slot further back, and the
  head does not move.
* **Removing** a match is `colors.splice(k, n)` — the marbles behind the gap
  instantly close it by moving forward one slot each.

Marbles enter from the start of the path: whenever `head - colors.length *
SPACING >= 0` there is room for another marble and one is shifted off the
level's spawn `queue`.

## Shooting

`shooter` sits at the centre of the spiral and holds a `current` and a `next`
colour. `shootMarble()` pushes a ball with velocity `SHOT_SPEED` along the
aim angle and promotes `next` to `current`. Up to `MAX_BALLS` may be in
flight.

Each frame every ball is advanced and tested against every marble in the
chain. On a hit the ball's position is projected onto the path by
`nearestPathDistance(x, y)` (coarse scan then a fine local scan), and the
insertion index is

```
index = clamp(ceil((head - ballDistance) / SPACING), 0, colors.length)
```

which places the ball ahead of or behind the marble it struck depending on
which side of it the ball actually is. A ball that leaves the canvas is
discarded.

## Matching and cascades

After an insertion, `resolveMatches(index)` grows a run outwards from the
inserted marble. A run of three or more is removed, scoring
`10 * runLength * multiplier`. Removing a run brings two previously separated
marbles together, so the junction is re-checked and any further match scores
with `multiplier + 1` — that is the combo/cascade system. `combo` is the
number of removals produced by the current shot; from the second removal on, a
`COMBO x<n>` label floats off the board where the marbles were.

## Levels

| Quantity | Formula |
|---|---|
| Colours in play | `min(3 + floor((level - 1) / 2), COLORS.length)` |
| Marbles in the level | `min(28 + 6 * (level - 1), 60)` |
| Chain speed (px/s) | `22 + 4 * (level - 1)` |

A level is a race over *distance*, not time: the last marble of the queue only
enters after the head has travelled `levelMarbles() * SPACING`, so the count is
capped at 60 — comfortably under `pathLength / SPACING` (~82) — to guarantee
every level can still be finished before the head reaches the hole. Speed
scaling is what makes later levels hard, because it shrinks the player's
reaction time without changing that race.

Clearing every marble (empty chain *and* empty queue) awards `500 * level`
and starts the next level immediately with a short on-canvas message. When
`head >= pathLength` the chain has reached the hole and the game ends; the
best score is persisted to `localStorage` under `marble-loop-best`.

## Controls

| Input | Action |
|---|---|
| Mouse move | Aim the launcher |
| Click / tap on the board | Fire |
| <kbd>←</kbd> <kbd>→</kbd> | Rotate the launcher |
| <kbd>Space</kbd> | Start the game / fire while playing |
| <kbd>S</kbd> | Swap the current and next marble |
| <kbd>P</kbd> | Pause / resume |
| <kbd>R</kbd> | Restart |

## Code layout

* `index.html` — HUD, canvas, overlay, control legend.
* `style.css` — dark arcade styling matching the rest of the repo.
* `game.js` — a single classic (non-module) script. All state and helpers are
  plain globals so the Playwright specs can drive the simulation directly.
  Motion is expressed per second and applied by `step(dt)`, so tests advance
  the world deterministically instead of waiting on `requestAnimationFrame`.
* `tests/marble-loop.spec.js` — Playwright specs, written before the
  implementation.

## Assumptions

These were ambiguous in the task description; the simpler reading was taken in
each case and is recorded here.

1. **Branch name.** The task asked for a branch named after the game
   (`marble-loop`), but this session is pinned to the branch
   `claude/loving-euler-x9m3th` and is not permitted to push elsewhere. Work
   was done on the pinned branch; the game name is carried by the folder and
   commit messages instead.
2. **Gap closing is instantaneous.** Real Zuma rolls the back half of the
   chain forward over a few frames after a match, which can trigger further
   collisions. Here the gap closes in the same frame. This keeps the chain a
   single contiguous run and makes the simulation exactly reproducible in
   tests.
3. **Insertion never advances the chain.** Marbles behind the insertion point
   are pushed backwards (the head is untouched), so a shot can never shorten
   the player's remaining time. If the tail is pushed back past the start of
   the path those marbles visually pile up at the entrance, and spawning
   pauses until there is room again.
4. **Destroying marbles pulls in replacements immediately.** Because the gap
   closes at once, the tail moves forward at once, and the spawn rule
   (`head - colors.length * SPACING >= 0`) refills the freed space from the
   queue in the same frame. So while marbles remain queued a match does not
   shorten the chain on screen — it eats into the queue instead, and the chain
   only starts shrinking once the queue is empty. That is what makes "clear
   the level" a race to drain the queue.
5. **No rollback/reverse animation, no power-up marbles** (bomb, colour
   swap, slow-down). The scope is the core loop only.
6. **Aiming is unrestricted.** The launcher can point in any direction,
   including back over already-cleared track; there is no "cannot shoot
   through the hole" rule.
7. **The launcher's colours are drawn from the colours still in play**
   (chain plus spawn queue) when any remain, so the player is never handed a
   marble that cannot possibly match.
8. **Level progression is endless.** There is no final level; difficulty keeps
   scaling by the formulas above.
