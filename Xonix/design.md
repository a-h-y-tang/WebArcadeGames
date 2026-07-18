# Xonix — Design

## Concept

Xonix is a territory-capture arcade game. You steer a marker around the edge of a
rectangular sea. Darting out from the safe land, you carve a **trail** across the
water and back to land; the moment you close the loop, the area you fenced off
(the side that contains no enemy) turns to solid land. Claim enough of the map to
win — but if a bouncing enemy touches your live trail, or you cross your own
trail, you lose a life.

It is a fresh mechanic for this arcade: the first game whose core is a
flood-fill **area-capture** simulation rather than shooting, matching, or
platforming.

## The grid & cell states

The world is a `ROWS × COLS` grid. Every cell is in one of three terrain states;
the player and enemies are separate markers drawn on top.

| State | Meaning |
|-------|---------|
| `SEA`   | Open water — capturable, and where enemies roam. |
| `LAND`  | Solid, safe ground. The outer border starts as land. |
| `TRAIL` | The line you are currently drawing across the sea. Fatal to touch. |

## Mechanics

### Moving & drawing
- The player moves one cell per tick in the current direction (Arrow keys / WASD
  set the direction, as in Snake).
- Moving onto **LAND** while not drawing is free movement along safe ground.
- Moving onto **SEA** starts (or extends) a trail: that cell becomes `TRAIL` and
  you are now "drawing".
- Moving back onto **LAND** while drawing **seals** the trail (see Capture).
- Moving onto your own **TRAIL** is fatal.

### Capture (the flood fill)
When a trail is sealed:
1. Every `TRAIL` cell becomes `LAND`, forming a wall.
2. A flood fill runs through the remaining `SEA` starting from **every enemy**
   (4-connected). Any sea an enemy can still reach stays sea.
3. Every sea cell the flood could **not** reach is enclosed — it becomes `LAND`.
4. The claimed percentage is recomputed. Reaching the **target percentage**
   (75%) wins the level.

Because the trail seals the boundary, the pocket without an enemy is exactly the
region that gets filled — the classic Xonix capture.

### Enemies
- Enemies bounce diagonally through the sea. Hitting land (or the border)
  reflects the corresponding velocity component, as with a ball.
- If an enemy moves onto a `TRAIL` cell (your live line), you lose a life.

### Lives, losing, winning
- You start with 3 lives. Losing one clears the current trail (it reverts to sea)
  and returns you to the start; at 0 lives the game is over.
- Win by claiming at least the target percentage of the sea. Score increases with
  every cell captured, and the best score persists in `localStorage`.

## Controls

| Input | Action |
|-------|--------|
| Arrow keys / WASD | Set movement direction |
| R | Restart |
| P | Pause / resume |
| Start button | Begin from the intro overlay |

## Rendering

A single `<canvas>` (600 × 450, a 40 × 30 grid of 15 px cells) redrawn each
animation frame. Player movement and enemy motion advance on a fixed timer,
independent of the render loop, so the simulation is deterministic and testable.
Intro / win / game-over use an HTML overlay, matching the other games here.

## Testable API (exposed as globals)

- `grid` — 2-D array of cell states; `TILE` — the state enum.
- `player` — `{x, y}`; `enemies` — `[{x, y, dx, dy}]`; `drawing` — boolean.
- `state`, `lives`, `score`, `percent`, `targetPercent`.
- `movePlayer(dx, dy)` — one player step (draw / seal / self-hit).
- `enemyStep()` — advance all enemies one step (bounce / trail-hit).
- `sealTrail()` / `floodCapture()` — seal and run the capture flood fill.
- `loadMap(ascii, opts)` — build a scenario from an ASCII map
  (`#`=land, `.`=sea, `P`=player, `e`=enemy, `T`=trail) for tests.

The capture is a pure flood fill over an explicit grid, so tests build a tiny
sea with a dividing trail and one enemy, seal it, and assert the exact cells that
became land — textbook TDD.

## Assumptions

Ambiguities were resolved toward the simpler option and recorded here:

1. **Sea-only enemies (Qix-style fliers).** No separate land-chaser enemy; every
   enemy bounces in the water. One enemy type keeps the rules and tests clean.
2. **Discrete one-cell-per-tick motion** for both player and enemies — fully
   deterministic, no sub-cell physics.
3. **Trail sealed only by reaching land**, not by any timer. Simple and
   unambiguous.
4. **Flood fill from enemies decides captured area.** The enemy-free pocket is
   filled; if there were somehow no enemies, all sea is claimed.
5. **Default enemy velocity is diagonal `(1, 1)`**; tests may override it.
6. **Target 75%, 3 lives, one screen.** Fixed single level; more could be added
   as data later.
7. **Design doc is `design.md`** (lowercase) to match every other game and the
   root README's stated convention.
