# Marble Chain — Design

## Concept

A marble-shooter in the Zuma tradition. A chain of coloured marbles crawls along a
spiral track toward a skull pit at the centre of the board. The player controls a
turret parked in the middle of the spiral, firing coloured marbles into the moving
chain. Landing three or more of the same colour together detonates them; clearing
the whole chain before its head reaches the pit completes the level.

This is deliberately *not* the grid-based `BubbleShooter` already in the repo: there
is no static grid, and the entire play field is a one-dimensional path that the
marbles are packed along. All the interesting geometry is "distance along the path"
rather than "row/column".

## Board geometry

The track is an Archimedean-style spiral squashed into an ellipse:

```
t  ∈ [0, TURNS · 2π]
r(t) = R_OUTER + (R_INNER − R_OUTER) · t / t_max
x(t) = cx + r(t) · cos(t)
y(t) = cy + r(t) · sin(t) · Y_SQUASH
```

The curve is sampled into a polyline of ~1500 points at load time and the cumulative
arc length of each segment is stored, giving two cheap primitives used everywhere:

- `pathPointAt(d)` — the `{x, y}` at arc-length `d` from the start (linear
  interpolation between samples, clamped to the ends).
- `PATH_LENGTH` — the total arc length; the pit sits at `pathPointAt(PATH_LENGTH)`.

The turret sits at the geometric centre of the spiral, so it has line of sight to
almost every part of the track.

## Chain model

The chain is stored as a **packed array plus a single head offset**:

```js
chain = { head: 137.5, balls: [{color: 2}, {color: 0}, ...] }   // balls[0] is the front
distanceOf(i) = chain.head − i * BALL_SPACING
```

Because the array is always packed, insertion and removal are plain `splice` calls
and the marbles behind the edit instantly re-pack — no per-marble velocity, no gap
book-keeping, and the chain can never be internally inconsistent. `chain.head` is
the only thing that moves during normal play (`head += speed · dt`).

Marbles whose distance is negative have not emerged from the tunnel mouth yet and
are simply not drawn.

New marbles are appended at the tail whenever the tail has travelled far enough to
leave room (`tailDistance ≥ BALL_SPACING`) and the level still has marbles left to
release.

## Shooting

- The turret holds a `current` marble and shows a `next` one.
- `shoot()` spawns a projectile travelling at `PROJECTILE_SPEED` along the aim
  angle, then promotes `next` to `current` and rolls a fresh `next`.
- New turret colours are only ever drawn from colours **still present in the chain**
  (falling back to the level's palette when the chain is empty), so the player can
  never be handed a dead marble.
- Each step, a projectile is tested against every visible chain marble. On contact
  (centre distance < `2 · BALL_R`) it is absorbed: the nearest chain marble is found,
  and the projectile is inserted either in front of or behind it depending on which
  of that marble's neighbours the impact point is closer to. Projectiles that leave
  the canvas are discarded.

## Matching and combos

After an insertion at index `i`, `resolveMatches(i)` walks outward from `i` while the
colour matches. A run of three or more is removed with `splice`, which makes the two
marbles that flanked the run adjacent — so the function then re-checks that seam and
loops, incrementing a combo counter each time. Scoring is

```
points = 10 · runLength · combo         (combo = 1 for the first blast, 2 for the
                                         chain reaction it triggers, and so on)
```

Clearing the level awards `250 · level`.

## Levels

`level` raises three things: the crawl speed, the number of marbles released, and
the palette size (4 colours for the first two levels, 5 afterwards). A level ends
when the release queue is empty *and* the chain is empty; the next level starts
immediately with a fresh chain. The game ends when `chain.head ≥ PATH_LENGTH`, i.e.
the leading marble falls into the pit.

## Controls

| Input | Action |
|---|---|
| Mouse move | Aim the turret |
| Click | Fire |
| `←` / `→` | Aim left / right |
| `Space` | Fire (and start the game from the title screen) |
| `S` | Swap the current and next marble |
| `P` | Pause / resume |

## Code layout

`game.js` is a single classic (non-module) script — matching Kaboom, Snake, Tetris
and the rest of the repo — so every piece of state is a plain global the Playwright
tests can read and poke. All motion is per-second and advanced through `step(dt)`,
so tests simulate frames deterministically instead of waiting on
`requestAnimationFrame`. Randomness goes through a seeded LCG (`setSeed(n)`), which
keeps colour rolls reproducible in tests.

Test hooks worth knowing about:

- `startGame()`, `nextLevel()`, `endGame()`, `togglePause()`
- `setChain(colorIndices, head)` — install an exact chain for a scenario
- `insertBall(index, color)`, `resolveMatches(index)`
- `spawnProjectile({angle, color, x, y})`, `shoot()`, `setAim(angle)`, `swapShooter()`
- `pathPointAt(d)`, `ballPos(i)`, `ballDist(i)`

## Assumptions

Decisions taken without asking, always choosing the simpler reading:

1. **Branch name.** The task asked for a branch named after the game
   (`marble-chain`), but this session is pinned to the designated branch
   `claude/loving-euler-hpam32` and must not push elsewhere. The work lives there;
   `marble-chain` is used as the game's id/slug instead.
2. **One packed chain, not multiple segments.** Real Zuma splits the chain into
   independently-moving segments with gaps that close over time. Here the chain is a
   single packed train, so a removal makes the tail catch up instantly rather than
   sliding. Much simpler to reason about and to test, and it plays fine.
3. **Insertions extend the tail, not the head.** Adding a marble never pushes the
   chain closer to the pit; the extra length appears at the back. This is friendlier
   than the arcade original and removes a whole class of unfair deaths.
4. **No post-match backward slide.** Clearing marbles does not shove the front of
   the chain away from the pit — the head keeps its position.
5. **No power-ups.** No slow-down, reverse, accuracy or bomb marbles; scoring and
   combos carry the depth instead.
6. **Levels advance immediately.** Clearing a level starts the next one on the same
   frame with a brief banner rather than a modal "level complete" screen.
7. **Colour palette grows once.** 4 colours on levels 1–2, 5 from level 3 on; no
   further growth, so late levels get faster rather than more chaotic.
8. **Best score only** is persisted (`localStorage` key `marble-chain-best`); there
   is no save/resume of an in-progress game.
