# Marble Loop — Design

## Concept

**Marble Loop** is a path-based marble shooter in the tradition of *Puzz Loop* /
*Zuma*. A conveyor of coloured marbles crawls along a winding track toward a pit
at the end of the line. The player sits on a fixed turret in the middle of the
track and lobs marbles into the advancing chain. Landing three or more of the
same colour in a row pops them; the marbles behind roll forward to close the gap,
which can trigger further pops for a combo. Clear every marble before the head of
the chain reaches the pit and the level advances.

Nothing else in this repo plays like it: `BubbleShooter`, `Match3` and `GemMatch`
are all grid-aligned, while Marble Loop's board is a one-dimensional chain whose
geometry is an arbitrary curve. The interesting code is the arc-length
parameterised path, the insertion maths, and the gap-closing simulation.

## Files

| File | Role |
|---|---|
| `index.html` | Markup: HUD, canvas, overlay, help strip |
| `style.css` | Presentation only |
| `game.js` | All game logic and rendering (single classic script) |
| `tests/marble-loop.spec.js` | Playwright suite (written before the implementation) |

`game.js` is a plain, non-module script so that its state and pure helpers are
reachable from Playwright as globals — the same convention Kaboom, Snake and
Tetris use in this repo. All motion is expressed per second and driven through
`step(dt)`, so tests advance the simulation deterministically instead of racing
`requestAnimationFrame`.

## Core model

### The path

A level's track is an **arc-length parameterised polyline**. A generator produces
coarse control points, `buildPath()` resamples them at ~2 px intervals and stores
a cumulative-length table. Two lookups drive everything else:

- `pointAt(t)` → `{x, y}` at distance `t` along the track
- `tangentAt(t)` → unit direction of travel at `t`

Three generators cycle by level: a spiral, a serpentine and a horseshoe. Each
also declares where the turret sits, so the shooter is always inside the track's
negative space.

### The chain

`chain` is an array of `{ t, color }` ordered **front first** — `chain[0]` is the
marble nearest the pit and has the largest `t`. Two invariants hold:

1. `chain[i].t <= chain[i-1].t - SPACING` — marbles never overlap.
2. `chain[0].t < pathLength` — otherwise the level is lost.

Because the chain is one-dimensional, "adjacency" is just array adjacency, and a
match is a maximal run of equal colours.

### Marching and gap closing

`marchChain(dt)` is the heart of the simulation:

```
chain[0].t += speed * dt                    // the head always advances
for i in 1..n-1:
    target = chain[i-1].t - SPACING
    if chain[i].t > target:  chain[i].t = target          // squeeze up, no overlap
    else:                    chain[i].t += catchupSpeed * dt, clamped to target
```

A marble only counts as *detached* once it trails by more than `GAP_EPS` (1 px).
This matters: the head's own advance opens a sub-pixel gap behind every marble on
every frame, so without the threshold the whole chain would be re-tested for
matches continuously and any run of three would pop the instant it formed,
without ever being shot at. Only a genuine gap — left by a pop, or by a marble
entering at the tail — arms a junction, and the frame it closes is the frame its
match is tested.

New marbles enter at `t = 0` whenever `pending > 0` and the tail has rolled far
enough forward to leave room.

### The tunnel

Insertion pushes the marbles behind it back, so a busy chain can be shoved past
the start of the track into negative `t`. Those marbles are treated as still
inside the feed tunnel: `inTunnel()` excludes them from both rendering and
`hitTest()`, so they are neither drawn stacked on the entrance nor shootable, and
they roll out of the tunnel mouth as the chain advances. A backed-up tunnel is
the visible cost of bad shots.

### Shooting and insertion

`aimAt(x, y)` points the turret; `shoot()` launches `shooter.current` along that
heading and promotes `shooter.next`. Upcoming colours are drawn only from colours
still present in the chain (falling back to the level's palette while the chain is
empty), so a level can never become unwinnable.

A projectile that comes within `2 * MARBLE_R` of a chain marble `k` is inserted
next to it. Which side is decided by projecting the approach onto the track's
tangent at `k`: arriving from in front inserts at index `k`, arriving from behind
inserts at `k + 1`. Everything behind the insertion point is pushed back by
`SPACING` to make room, which is exactly the gap the catch-up rule will later
close.

### Matching and scoring

`resolveMatches(index)` grows a run outward from `index`; runs of three or more
are spliced out. Each pop scores `10 × marbles × comboStep`, where `comboStep`
starts at 1 for every shot and increments after each pop — so a cascade of three
pops from one shot pays 1×, 2×, 3×.

### Level flow

A level is cleared when `pending === 0 && chain.length === 0`; `startLevel()`
then rebuilds the track and refills the queue with more marbles, more colours and
a faster crawl. The game ends when `chain[0].t >= pathLength`; the best score is
persisted to `localStorage` under `marble-loop-best`.

## Controls

| Input | Action |
|---|---|
| Mouse move | Aim the turret |
| Click / `Space` | Fire |
| `S` | Swap the loaded marble with the next one |
| `P` | Pause / resume |
| `R` | Restart |

`Space` also starts the game from the title and game-over screens.

## Assumptions

These were the ambiguous points; in each case the simpler reading was taken and
recorded here rather than escalated.

1. **Branch name.** The task asked for a branch named after the game
   (`marble-loop`), but this session's standing instructions designate
   `claude/loving-euler-dsqxys` as the branch to develop and push on. The
   designated branch wins; `marble-loop` is not created.
2. **No backward roll after a pop.** In the arcade original the front segment
   drifts backward briefly after a match. Only the *rear* segment catching up is
   modelled here — one rule instead of two, and it keeps the invariant above
   trivially true.
3. **No power-ups.** No bombs, colour-swaps, slow-downs or accuracy lasers. The
   scoring combo is the only depth mechanic.
4. **Levels are endless.** There is no final level or win screen; difficulty
   scales until the player loses.
5. **Level transitions do not pause.** Clearing a level immediately builds the
   next one and shows a short banner, rather than opening a modal the player has
   to dismiss.
6. **One projectile at a time.** Firing is disabled while a marble is in flight,
   which keeps insertion order unambiguous.
7. **Difficulty curve** is linear in the level number (see `levelConfig()`)
   rather than hand-authored per level.
8. **Fixed 640×480 canvas**, CSS-scaled for narrow viewports — consistent with
   the other games in the repo, which all use a fixed backing store.
9. **The tunnel is unbounded.** Nothing caps how far the chain can be pushed
   behind the start of the track; a player who keeps missing simply builds a
   longer backlog rather than hitting a wall.

## Verification

Beyond the 66 Playwright specs, the game was soak-tested with a scripted bot
(aim at a visible marble matching the loaded colour, swap if none, fire) driving
`step()` at 60 Hz for six simulated minutes. It cleared levels 1–3 and lost on
level 4 at 4170 points, with no uncaught errors and no frame in which the
non-overlap invariant was violated — confirming both that a level is actually
clearable and that the difficulty curve eventually bites.
