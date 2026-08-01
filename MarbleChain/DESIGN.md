# Marble Chain — Design

## Concept

A chain of coloured marbles crawls along a winding track toward a hole at the
end of the path. A turret sits in the middle of the field and launches marbles
into the chain. Land three or more of the same colour together and they burst;
clear the whole chain before it reaches the hole.

It is the "path shooter" branch of the match-3 family (Zuma / Puzz Loop). The
repo already has *Bubble Shooter*, which is a **static hex grid** — every shot
sticks to a fixed lattice and the field descends in discrete steps. Marble Chain
is mechanically different: the target is a **moving one-dimensional queue**, a
shot *inserts* between two neighbours and shoves the rest of the chain
backwards, and gaps left by a burst close over time, which is what produces
chain-reaction combos. Nothing else in the repo models a train of objects
travelling along a spline.

## Board and path

- Canvas is a fixed `640 × 480`.
- The track is a serpentine polyline: three horizontal lanes joined by
  half-circle turns, ending in a hole at the lower right. It is built from
  line/arc primitives, then **resampled to 1 px spacing** so that `pathPoint(d)`
  is a cheap lookup and every distance-based calculation is uniform.
- A marble's whole state on the track is one number: `dist`, its arc length from
  the spawner. `balls[0]` is the front-most marble (largest `dist`);
  the array is always sorted by descending `dist`.
- `pathPoint(d)` extrapolates linearly outside `[0, PATH_LENGTH]` rather than
  clamping, so marbles pushed back past the spawner still have a sane position
  instead of piling on one pixel.

## Mechanics

**Chain movement.** Every marble advances at `chainSpeed()` (scales with level).
After the advance, the chain is re-packed front to back:

- gap smaller than `SPACING` → the marble is snapped back to exactly `SPACING`
  behind the one ahead (the chain is rigid, it never overlaps);
- gap larger than `SPACING` → the marble rolls forward at an extra `CATCH_UP`
  speed until it touches. This is how a hole left by a burst closes.

**Spawning.** While `spawnRemaining > 0`, a new marble is emitted at `dist = 0`
whenever the tail has travelled at least `SPACING` clear of the spawner.

**Shooting.** The turret holds a current marble and a preview of the next one.
`fire()` spawns a projectile along the aim angle and promotes the preview.
A short cooldown stops a single keypress from emptying the turret. Turret
colours are drawn from the colours actually present in the chain, so the player
is never handed a dead colour.

**Insertion.** A projectile that overlaps a chain marble is removed and inserted
into the queue. Which side it lands on is decided by projecting the offset onto
the path tangent at the marble it hit: ahead of the tangent → it takes that
marble's index, otherwise it goes in behind. Every marble from the insertion
point back is shifted one `SPACING` further from the hole — a good shot buys
distance as well as a burst.

**Matching.** After an insertion (and after any gap closes) the run of identical
colours around that index is measured. Three or more burst.

**Combos.** `combo` resets on every shot and increments on every burst it
causes. Points are `count × 10 × combo`, so a burst that closes a gap into a
second burst is worth double, a third is worth triple. This is the only place
skill compounds, and it is why gap-closing is simulated rather than instant.

**Level flow.** Clearing every marble (nothing left to spawn, chain empty) awards
a bonus and starts the next level: more marbles, more colours (up to six), and a
faster chain. Any marble reaching `PATH_LENGTH` ends the run.

## Controls

| Input | Action |
|---|---|
| Mouse move | Aim the turret at the cursor |
| Click | Fire |
| `←` `→` | Rotate the turret |
| `Space` | Fire (start / restart when idle or game over) |
| `S` | Swap the loaded marble with the preview |
| `P` | Pause / resume |

Aim is clamped to the upper half so you cannot fire into your own back.

## Code layout

Single classic (non-module) script, matching Kaboom, Snake and Tetris in this
repo: game state lives in plain globals so the Playwright specs can read and
drive it directly. All motion is per-second and advanced through `step(dt)`;
`requestAnimationFrame` only supplies `dt` and calls `draw()`. Tests therefore
simulate frames deterministically and never race the wall clock.

Key seams used by the tests: `startGame()`, `step(dt)`, `pathPoint(d)`,
`pathTangent(d)`, `setChain(colors, frontDist)`, `insertBall(index, color)`,
`resolveMatches(index)`, `spawnProjectile(p)`, `fire()`, `setAimDir(d)`,
`aimAt(x, y)`, `swapNext()`, `togglePause()`, `endGame()`.

## Assumptions

These were ambiguous in the brief; the simpler reading was taken each time and
recorded here.

1. **Single track, no branching.** Real Zuma levels sometimes have two paths or
   tunnels. One continuous serpentine path is used — simpler to reason about and
   to test, and it keeps the whole marble state as a single scalar.
2. **Colours are palette indices** (`0..COLORS.length-1`), not CSS strings, so
   tests can assert on colours without depending on the exact hex values.
3. **No power-ups.** The original's accuracy/slow/backwards bonuses are omitted;
   scoring depth comes from the combo multiplier instead.
4. **The chain is rigid, never elastic.** Marbles are re-packed to exactly
   `SPACING` each frame rather than being simulated as springs.
5. **Only one gap junction is resolved per frame.** Resolving a match mutates the
   array, invalidating later indices; the next frame picks up any remaining
   junction. At 60 fps this is invisible.
6. **A missed shot costs nothing** beyond the time it takes to reload. There is
   no ammo limit, so the only pressure is the advancing chain.
7. **Levels advance immediately** on a clear (bonus added to score) rather than
   showing an interstitial screen.
8. **Best score is per-browser**, kept in `localStorage` under
   `marble-chain-best`, consistent with the other games here.
9. **The designated feature branch is used for delivery.** The task asked for a
   branch named after the game (`marble-chain`); the session's standing
   instruction pins development to `claude/loving-euler-a9gly2`, so that branch
   is used and this note records the divergence.
