# Marble Shooter — Design

A Zuma-style marble shooter on an HTML5 canvas. A conga line of coloured marbles
crawls along a fixed spiral track toward a pit at its centre. The player sits in
the middle of the spiral on a rotating shooter and fires marbles into the line.
Three or more same-coloured marbles touching each other pop; the gap closes,
which can trigger chain reactions. Clear every marble before the line reaches
the pit.

## Concept

| | |
|---|---|
| Genre | Action / puzzle arcade |
| Canvas | 640 × 560, single `<canvas id="canvas">` |
| Goal | Pop every marble in a level before the leading marble falls into the pit |
| Lose | The leading marble reaches the end of the track |
| Win | Clear a level → the next level starts with more marbles, more colours and a faster crawl |

## Track geometry

The track is an inward elliptical spiral centred on the canvas:

```
angle(t)  = START_ANGLE + t * TURNS * 2π
radius(t) = lerp(outer, inner, t)          // separately for x and y
```

It is sampled at a fixed step into a polyline, and the cumulative segment
lengths give an arc-length table. `pointAt(d)` maps a distance along the track
to an `{x, y, angle}` pose by binary-searching that table and interpolating, so
every marble only ever needs to store a scalar distance `d`.

The shooter sits at the spiral's centre; the pit is the final point of the
track, just outside the shooter, drawn as a dark well.

## The chain

The chain is stored as `marbles`, ordered **head first** — `marbles[0]` is the
marble nearest the pit (largest `d`). The chain is treated as *rigid*: marble
`k` always sits at `marbles[0].d - k * MARBLE_D`. `restack()` re-derives every
marble's `d` from the head, and is called after any structural change. This
single invariant makes all the interesting operations trivial and exact:

| Operation | Effect on the chain |
|---|---|
| **Advance** (`step`) | `marbles[0].d += speed * dt`, then `restack()` |
| **Spawn** | append a marble at the tail when there is room (`tail.d ≥ MARBLE_D`) |
| **Insert** a shot at index `i` | splice it in, `marbles[0].d += MARBLE_D` (the part ahead of the insertion is shoved toward the pit), then `restack()` |
| **Pop** a run | splice the run out, then `restack()` from the surviving head — the section behind the gap snaps forward to close it |

Popping the head group is handled by the same rule: the new `marbles[0]` keeps
the `d` it already had, so the chain does not lurch forward when the front of it
disappears.

## Shooting and matching

* `setAim(x, y)` points the shooter at a canvas coordinate; `shoot()` launches
  the loaded marble along `aimAngle` at `SHOT_SPEED`. The queued "next" marble
  becomes the loaded one and a fresh one is queued.
* A projectile that leaves the canvas is discarded with no penalty.
* Collision is a simple circle test against every chain marble
  (`dist < MARBLE_R * 2`). On a hit, the sign of
  `dot(projectile − marble, trackTangent)` decides whether the shot lands ahead
  of or behind the marble it struck.
* `resolveMatches(i)` grows a run of identical colours outward from the inserted
  marble. A run of `MIN_MATCH` (3) or more pops. After a pop, the two marbles
  now adjacent across the gap are re-checked, so chain reactions resolve in a
  loop with a rising combo multiplier.
* Score per pop = `run × POINTS_PER_MARBLE × level × combo`.

### Why the shove is the whole difficulty curve

The insertion shove is what makes accuracy matter, and it falls out of the rigid
model for free:

* A shot that **pops at the head** costs nothing. The insert moves the head
  forward one marble, then the run pops and the first survivor keeps exactly the
  `d` it already had — the chain ends up where it started.
* A shot that **pops mid-chain** costs one marble-width, because the head stays
  shoved while the gap closes from behind.
* A shot that **does not match** costs a marble-width *and* leaves a marble
  behind.

So a careful player spends almost none of the track on shoves and has the full
~100 seconds of crawl to clear a level, while spraying shots burns the track
faster than the chain crawls. A scripted bot that fires every 0.13 s loses on
level 1 despite scoring well — spraying is genuinely fatal, deliberate aiming is
comfortable.

## Ball colours

New marbles for the shooter are drawn from the colours actually present in the
chain (falling back to the level's palette when the chain is empty), so the
player is never handed a dead colour. Randomness comes from a seeded
`mulberry32` generator exposed as `setSeed(n)`, which keeps the Playwright tests
deterministic.

## Difficulty curve

```
marblesForLevel(l) = MARBLES_BASE + (l - 1) * MARBLES_STEP     (28 + 6/level)
levelSpeed(l)      = BASE_SPEED   + (l - 1) * SPEED_STEP       (26 + 4/level px/s)
colorsForLevel(l)  = min(COLORS.length, 3 + floor((l - 1) / 2))
```

## Controls

| Input | Action |
|---|---|
| Mouse move | Aim the shooter |
| Mouse click | Fire |
| <kbd>←</kbd> / <kbd>→</kbd> | Rotate the aim |
| <kbd>Space</kbd> | Start the game / fire while playing |
| <kbd>S</kbd> | Swap the loaded and queued marbles |
| <kbd>P</kbd> | Pause / resume |

## Code layout

Single classic (non-module) script, matching the rest of the repo, so all state
and helpers are reachable from Playwright as plain globals. All motion is
per-second and advanced through `step(dt)`, so tests simulate frames
deterministically without touching `requestAnimationFrame`.

* `index.html` — HUD, canvas, overlay
* `style.css` — dark arcade theme shared in spirit with the other games
* `game.js` — track building, chain logic, projectiles, rendering, input
* `tests/marbleshooter.spec.js` — Playwright suite

### Exposed API used by the tests

`state`, `score`, `level`, `best`, `combo`, `marbles`, `projectiles`,
`remaining`, `currentBall`, `nextBall`, `aimAngle`, `shooter`, `pathLength()`,
`pointAt(d)`, `startGame()`, `endGame()`, `togglePause()`, `updateHud()`,
`step(dt)`, `setSeed(n)`, `setMarbles(colors, headDist)`, `restack()`,
`setAim(x, y)`, `shoot()`, `shootAt(x, y)`, `swapBalls()`, `nextLevel()`,
`colorsForLevel(l)`, `levelSpeed(l)`, `marblesForLevel(l)`.

## Assumptions

These were decided autonomously; each takes the simpler reading of an ambiguous
requirement.

1. **Branch name.** The task asks for a branch named after the game
   (`marble-shooter`), but this session is pinned to the designated development
   branch `claude/loving-euler-ja76rr` and must not push elsewhere. The work is
   therefore developed on the designated branch; the game name is carried by the
   folder, commit and PR title instead.
2. **Gaps close instantly.** Real Zuma animates the back half of the chain
   sliding forward to close a gap. Here the gap closes in the same frame the run
   pops. This keeps the chain rigid and the maths exact, and plays essentially
   the same.
3. **The chain is rigid.** There is no "pushing"/"pulling" physics between
   marble groups — the whole line moves at one speed. Inserting a shot shoves
   the section ahead of it one marble-width toward the pit, which preserves the
   classic penalty for a sloppy shot.
4. **One life.** The leading marble reaching the pit ends the run outright,
   rather than costing a life and restarting the level. Simpler to reason about
   and to test; the score/best loop still gives the run stakes.
5. **No fire cooldown or projectile cap.** Shots are limited only by how fast
   the player can click. There is no rate limiter to reason about.
6. **Missed shots are free.** A projectile that flies off the canvas is simply
   discarded — no penalty, no marble added to the chain.
7. **Powerups are out of scope.** No bombs, colour-swaps, slow-downs or
   accuracy gems; the base pop/chain loop is the whole game.
8. **Level progression is endless.** Levels keep getting harder with no final
   level and no win screen — the game ends when the player loses.
