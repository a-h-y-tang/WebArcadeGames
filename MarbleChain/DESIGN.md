# Marble Chain — Design

## Concept

A chain of coloured marbles crawls along a winding track toward a pit at its
end. The player controls a cannon below the track, firing marbles into the
chain. Three or more marbles of the same colour touching each other burst; the
gap they leave closes as the rear of the chain catches up, which can bring two
same-coloured sections together for a combo. Clear every marble in a level
before the front of the chain drops into the pit.

The genre is the "marble shooter" (Puzz Loop / Zuma lineage). It is
deliberately distinct from the repo's existing `BubbleShooter` (a static
hex-grid wall) and `Match3` (a swap-based grid): here the target is a single
moving one-dimensional chain, and *when* you shoot matters as much as where.

## Files

| File | Role |
|---|---|
| `index.html` | HUD, canvas, overlay markup |
| `style.css` | Presentation only — no layout logic lives in JS |
| `game.js` | All game state and logic, as a classic (non-module) script |
| `tests/marblechain.spec.js` | Playwright specs driving the exported globals |

`game.js` is a classic script rather than an ES module so the Playwright tests
can reach state and functions as plain globals (`balls`, `step`, `startGame`,
…), which is the convention already used by Kaboom, Snake and Tetris here.

## Mechanics

### The track

`buildPath(lanes)` returns a serpentine polyline: straight lanes joined by
half-circle turns, ending in a short plunge to the pit. `setPath` precomputes
cumulative segment lengths so a marble can be stored as a single scalar — its
distance `dist` along the track — and turned into a screen position on demand:

- `pointAt(d)` → `{x, y}`, clamped at both ends of the track
- `tangentAt(d)` → unit direction of travel, used to decide which side of a
  struck marble a shot joins on
- `pathLength()` → total length; a marble reaching it has fallen into the pit

Levels 1–4 use three lanes, level 5 and up use four (a longer track, so a
level's larger marble count still fits).

### The chain

`balls` is an array ordered front-first (index 0 is nearest the pit), each entry
`{color, dist}`. Motion, in `updateChain(dt)`:

1. The front marble advances at `chainSpeed()` — `42 + 6·(level−1)` px/s.
2. Every following marble moves toward `previous.dist − BALL_D`, closing any gap
   at `CATCHUP` (200 px/s) but never overlapping.

That single rule gives all three behaviours the game needs: a packed chain
crawls rigidly, a gap left by a burst closes from the back, and marbles can
never pass through one another.

New marbles are fed onto the track at `dist = 0` whenever the tail has moved a
full diameter clear of the start (`feedChain`), until the level's quota
(`ballsForLevel`) is exhausted. A short grace period (`spawnDelay`) keeps the
first marble of a level from appearing instantly.

### Shooting and insertion

`shoot(angle)` launches a projectile from the cannon muzzle at 460 px/s, subject
to a 0.35 s cooldown, and reloads: the "next" marble becomes current and a new
next is drawn. A shot is discarded once it leaves the canvas.

Each frame every projectile is tested against every marble
(`findHit` — centre distance below one diameter; the chain is short enough that
a linear scan is cheaper than any index). On a hit, `joinChain`:

1. Projects the shot's offset from the struck marble onto the track tangent to
   decide whether it lands ahead of or behind that marble.
2. Splices it in at that index with `dist = neighbourAhead.dist + BALL_D`.
3. `reflow(k)` restores spacing outward from the insertion — the front section
   is shoved one diameter toward the pit, which is the cost of a careless shot.

### Matching

`resolveMatches(k)` grows a run of equal colours around the inserted marble. A
run of three or more bursts, scoring `10 × run length × combo`. If the marbles
left touching across the gap are the same colour, the loop repeats with the
combo multiplier raised — so a well-placed shot can cascade. `bestCombo` records
the longest cascade of the run.

### Levels and losing

A level ends when the quota is spent and the chain is empty; `nextLevel()` then
rebuilds the track, restocks, and adds a colour every three levels (four colours
at level 1, all six from level 7). The game ends the moment the front marble's
distance reaches the end of the track.

## Controls

| Input | Action |
|---|---|
| Mouse move | Aim the cannon |
| Left click | Fire (also starts a new game from the title/game-over screen) |
| `Space` | Swap the loaded marble with the next one (starts the game when idle) |
| Right click | Swap the loaded marble with the next one |
| `P` | Pause / resume |

The cannon is clamped to at least `AIM_LIMIT` radians above the horizon so it
can never fire into its own base.

## Testing

Tests are behavioural and driven through the same globals the game uses. Motion
is advanced by calling `step(dt)` directly rather than waiting on
`requestAnimationFrame`, so every timing assertion is deterministic. `setChain`
and `spawnProjectile` let a spec construct an exact situation (a chain of known
colours, a shot about to strike a chosen marble) instead of playing toward one.

Run them with:

```powershell
npx playwright test MarbleChain/tests/
```

## Assumptions

These were the ambiguous points; in each case the simpler reading was taken and
recorded here rather than escalated:

- **Chain reactions resolve instantly.** In arcade originals, sections that were
  separated slide together and only then match. Here, if a burst leaves two
  same-coloured sections adjacent in the array, they are treated as touching and
  matched immediately. It keeps matching a pure array operation and reads the
  same on screen, because the gap closes within a few frames anyway.
- **No rollback.** Some games in this genre pull the chain backwards briefly
  after a match. Omitted: the chain only ever moves forward, and gaps close from
  the rear.
- **Insertion pushes forward, never backward.** A shot always shoves the front
  section toward the pit rather than pushing the tail back off the track, which
  avoids marbles at negative distances and keeps the penalty for a bad shot
  legible.
- **Single continuous chain.** Bursts split the chain conceptually, but the game
  stores one array and lets the catch-up rule re-close it, rather than modelling
  independent sections with their own speeds.
- **No power-ups.** Bombs, colour-swap marbles and slow-down pickups are out of
  scope for the first version.
- **Colour sourcing.** Marbles fed onto the track are uniformly random from the
  level palette; marbles loaded into the cannon are drawn only from colours
  still present on the track, so the player is never handed a useless marble.
- **Randomness is unseeded.** `Math.random` is used directly; tests build the
  situations they assert on explicitly instead of seeding the generator.
- **Fixed 600×400 canvas**, matching the other games in this repo, with no
  responsive scaling beyond what the browser does to the element itself.
