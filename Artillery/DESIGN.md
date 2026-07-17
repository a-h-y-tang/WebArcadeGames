# Artillery Duel — Design

## Concept

A turn-based, two-player artillery game in the classic *Gorillas* / *Scorched
Earth* tradition. Two tanks sit on opposite ends of a randomly generated,
rolling terrain. On each turn the active player chooses a firing **angle** and
**power**, then launches a shell that flies under gravity and a per-round
**wind**. A direct hit on the opposing tank wins the round. Terrain blocks
shells and is carved into craters where shells land, so the battlefield evolves.

The whole game is driven by a small, **pure, deterministic physics core** so it
can be tested pixel-for-pixel without relying on rendering or randomness.

## Mechanics

- **Terrain** is a per-pixel height map (`terrain[x]` = surface `y`). It is
  generated from a seed (summed sine waves) so a given seed always yields the
  same battlefield. A flat platform is stamped under each tank.
- **Aiming**: each player has an `angle` (0°–90°, measured from horizontal) and
  a `power` (10–100). Player 0 (left, blue) fires up-and-right; player 1
  (right, red) fires up-and-left — the horizontal direction is mirrored.
- **Firing**: the shell starts at the tank's muzzle with velocity
  `v = power * POWER_SCALE`, decomposed by angle. Each fixed time step:
  - `vx += wind` (wind is a horizontal acceleration, + = blows right)
  - `vy += GRAVITY`
  - position advances by `(vx, vy)`.
  The shell stops when it (a) hits the terrain surface, (b) enters a tank's
  bounding box, or (c) leaves the canvas bounds.
- **Resolution**: a shell that lands inside the opponent's box wins the round
  for the shooter (+1 score) and starts a new round. Any other landing carves a
  crater and passes the turn to the other player. Wind is re-rolled each round.
- **Scoring**: first player to a target score could be added later; for now the
  running score of rounds won is shown in the HUD and persisted as a "best".

## Controls

| Input | Action |
|---|---|
| **← / →** | Decrease / increase angle |
| **↑ / ↓** | Increase / decrease power |
| **A / D** | Decrease / increase angle (alt) |
| **W / S** | Increase / decrease power (alt) |
| **Space / Enter** | Fire |
| **N** | New game (regenerate terrain) |
| **Start button** | Begin the duel |

Aiming inputs are ignored while a shell is in flight (`state === 'firing'`).

## Public API (exposed on `window` for tests)

- `state` — `'idle' | 'aiming' | 'firing' | 'over'`
- `currentPlayer` — `0` or `1`
- `players` — `[{ x, y, angle, power, score, dir }, ...]`
- `wind`, `terrain`, and the constants `W`, `H`, `GRAVITY`, `POWER_SCALE`
- `computeTrajectory({ x, y, angleDeg, power, dir, wind })` — **pure**; returns
  `{ points: [{x,y}...], hit: { type, x, y, playerIndex? } }`
- `startGame()`, `fireShot()` (async resolve), `adjustAngle(d)`,
  `adjustPower(d)`, `newRound(win)`, `resetGame()`
- Test seams: `loadTerrain(heights)`, `setWind(w)`, `generateTerrain(seed)`,
  `playerBox(i)`

## Assumptions

- **Two local players share one keyboard** (hot-seat). No AI opponent — the
  simpler interpretation of "two-player artillery". An AI could be added later.
- **No target-score match structure**: each round is independent; the HUD tracks
  cumulative rounds won. The simpler interpretation over a full best-of-N match.
- **Angles are 0°–90°** (never firing backwards over your own head). Keeps aiming
  intuitive and the input space small.
- **Wind is a constant horizontal acceleration** for the whole shot, not gusty.
- **Terrain is destructible only via craters** (no collapse/settling physics),
  the simpler model.
- Physics uses a **fixed time step of 1 unit** with tuned constants; distances
  are in canvas pixels. Determinism matters more than real-world units.
- Canvas is **800×500**.
