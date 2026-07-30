# Marble Shooter — Design

## Concept

A Zuma-style *path shooter*. A train of coloured marbles crawls along a spiral
track toward a hole at the centre of the board. A cannon fixed at the middle of
the spiral fires marbles into the train; three or more of the same colour in a
row pop. Clear the whole train before its head falls into the hole and the level
advances — let it reach the hole and the game is over.

The interesting part of the genre is the *chain*: shots are inserted into a
moving line rather than landing on a static grid, and a pop lets the rear of the
line catch up to the front, which can trigger further pops (combos).

## Board geometry

- Canvas is **600 × 400**, matching the other arcade games in this repo.
- The track is an **elliptical spiral**: angle `t` runs from `0` to `2.5`
  turns, with the radii shrinking linearly from `(282, 182)` to `(58, 48)`
  around the centre `(300, 200)`. It is sampled into a polyline (`PATH`) with
  cumulative arc lengths, so any distance along the track maps to a point via
  `pathPointAt(d)`; `pathLength` is the total.
- The **hole** sits at the inner end of the spiral. The **cannon** sits at the
  spiral's centre `(300, 200)`, comfortably inside the innermost coil.

## The chain

The chain is modelled as a **rigid train**, which keeps the simulation trivial
to reason about and to test:

- `marbles` is an array of `{ color }`, index `0` = front-most (nearest the
  hole), higher indices further back.
- `headDist` is the front marble's distance along the track. Marble `i` sits at
  `headDist - i * SPACING`, where `SPACING = 2 * MARBLE_R`. Marbles with a
  negative distance haven't emerged from the track's mouth yet and aren't drawn.
- Every frame `headDist += chainSpeed() * dt`. The whole train therefore moves
  as one piece; there are no independent sub-groups.

Consequences of the rigid-train simplification (see *Assumptions*):

- **Insert at index `k`** splices the new marble in, which pushes everything
  from `k` back one slot *away* from the hole — the classic "the line gets
  longer behind you" behaviour. Inserting at index `0` would otherwise displace
  the current front marble, so `headDist` is advanced by one `SPACING` instead,
  keeping every existing marble exactly where it was and putting the new marble
  one slot ahead.
- **Removing a run** starting at index `s` splices it out; marbles behind it
  immediately take the freed indices, i.e. the rear *snaps* forward to close the
  gap (in the original the rear slides forward over a fraction of a second).
  When `s === 0` there is nothing in front to close up to, so `headDist` is
  pulled *back* by `removed * SPACING` and the survivors stay put.

## Matching and combos

After an insert at index `k`, `resolveMatches(k)` walks outward from `k` to find
the maximal run of equal colours. If the run is 3 or longer it is removed and
scored, then the two marbles that have just become neighbours at the seam are
re-checked. Each successive pop in the cascade raises the combo multiplier:

```
points = removed * POINTS_PER_MARBLE * combo      (combo = 1, 2, 3, … per cascade step)
```

Clearing every marble in a level awards `LEVEL_BONUS * level` and starts the
next level.

## Difficulty

| Level | Marbles | Colours | Chain speed |
|---|---|---|---|
| 1 | 28 | 4 | 45 px/s |
| 2 | 32 | 5 | 53 px/s |
| 3 | 36 | 6 | 61 px/s |
| n | `min(28 + 4(n-1), 48)` | `min(3 + n, 6)` | `45 + 8(n-1)` |

The initial chain is generated so it never contains a run of three or more
(otherwise it would pop itself on frame one).

## Controls

| Input | Action |
|---|---|
| Mouse move | Aim the cannon at the pointer |
| Click | Fire |
| ← / → | Rotate the cannon |
| Space | Start the game / fire while playing |
| S | Swap the loaded marble with the next one |
| P | Pause / resume |

Firing has a short cooldown (`FIRE_COOLDOWN = 0.15 s`) so holding the button
doesn't empty a stream of marbles into the same spot. The cannon shows the
loaded colour and the next one; both are drawn from the colours still present in
the chain, so a shot is never a guaranteed dead end.

## Code layout

Plain, non-module scripts, like every other game here, so the Playwright tests
can reach the state as ordinary globals:

- `index.html` — HUD, canvas, overlay, help text.
- `style.css` — shared visual language with the rest of the repo (dark panel,
  amber accent).
- `game.js` — geometry, chain model, input, rendering. All motion is per-second
  and advanced by `step(dt)`, so tests simulate frames deterministically without
  touching `requestAnimationFrame`.
- `tests/marble-shooter.spec.js` — the Playwright suite, written first.

Test-facing entry points: `startGame`, `endGame`, `togglePause`, `step`, `fire`,
`setAim`, `aimAt`, `swapColors`, `setChain`, `insertMarble`, `resolveMatches`,
`marbleDist`, `marblePos`, `pathPointAt`, `nearestPathDist`, `chainSpeed`,
`colorCount`, `levelMarbleCount`, plus the state globals (`state`, `score`,
`best`, `level`, `marbles`, `headDist`, `shots`, `shooter`).

`setChain(colors, headDist)` replaces the chain with an explicit colour list,
which is how the colour-sensitive tests stay deterministic despite the random
generator.

## Assumptions

Decisions made without a human to ask; the simpler reading was taken each time.

1. **Rigid train, not independent groups.** The original game splits the line
   into sub-groups that drift apart and re-collide. Here the chain is always one
   contiguous train: gaps close instantly and the rest of the line is unaffected.
   This keeps the state to one number (`headDist`) plus a colour list.
2. **Gap closing is instantaneous** rather than animated, for the same reason.
3. **No power-ups.** The genre's accuracy/slow-down/backwards tokens are out of
   scope for a first version.
4. **One chain per level**, spawned in full at level start and emerging from the
   track mouth, rather than a continuous feed.
5. **No lives.** The head reaching the hole ends the run outright, which matches
   the original.
6. **Score-only progression**, with the best score kept in `localStorage` under
   `marble-shooter-best`, as in the other games here.
7. **Branch naming.** The task asked for a branch named after the game, and the
   repo's history uses exactly that convention (`calcudoku`, `frostbite`, …), so
   the work lives on `marble-shooter`. The session's pre-assigned
   `claude/loving-euler-hdkogs` branch is pushed to as well so both instructions
   are satisfied.
