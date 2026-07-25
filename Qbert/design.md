# Q*bert — Design Document

## Game Concept

A canvas re-creation of the 1982 arcade classic **Q\*bert**. The player hops a
little orange creature around an isometric pyramid of 28 cubes. Landing on a
cube changes its colour; colour every cube to clear the level. Hop off the edge
of the pyramid, or get caught by a red enemy ball, and you lose a life.

## Architecture

A single self-contained page with no dependencies: `index.html`, `style.css`,
and `game.js`. All game state and helper functions are declared at the top level
of `game.js` so they live in the page's global scope. This keeps the code simple
and lets the Playwright suite drive and inspect the game directly (`qbert`,
`cubes`, `enemies`, `state`, `score`, `lives`, `level`, `hop()`, `inBounds()`,
`neighborOf()`, `completedCount()`, `checkWin()`, `spawnEnemy()`) — the same
convention every other game in this repo uses.

## The Pyramid

The board is a pyramid with **7 rows**. Row `r` (0 = apex) holds `r + 1` cubes,
for **28 cubes** total. A cube is addressed by `(r, c)` with `0 ≤ r < 7` and
`0 ≤ c ≤ r`.

`cubes[r][c]` stores a colour **level**: `0` = uncoloured, `TARGET` (1) =
coloured. A level is complete when every cube is at `TARGET` (`completedCount()`
`=== 28`).

### Isometric coordinates

Each cube is rendered as an isometric block. For cube `(r, c)`:

```
isoX = 2 * c - r
centerX = ORIGIN_X + isoX * HW      // HW = half top-face width
centerY = ORIGIN_Y + r * V_STEP     // V_STEP = HH + SH
```

The four hop directions map to grid neighbours:

| Direction  | Neighbour   |
|------------|-------------|
| up-left    | `(r-1, c-1)`|
| up-right   | `(r-1, c)`  |
| down-left  | `(r+1, c)`  |
| down-right | `(r+1, c+1)`|

A move whose neighbour is **not** `inBounds` means Q\*bert hops off the pyramid —
a fall — and costs a life.

## Mechanics

- **Colouring:** landing on an uncoloured cube sets it to `TARGET` and scores
  **25** points. Re-landing on an already-coloured cube scores nothing.
- **Falling:** hopping to an out-of-bounds cube costs a life; Q\*bert respawns on
  the apex and all enemies are cleared. Coloured cubes are **kept**.
- **Enemies:** red balls spawn near the top on a timer (`spawnMs`) and hop
  downward (`enemyHopMs`), picking a random in-bounds down-diagonal each hop.
  A ball that reaches the bottom row disappears. If a ball shares Q\*bert's cube
  — whether Q\*bert hops into it or it hops into Q\*bert — Q\*bert loses a life.
- **Lives:** you start with **3**. At 0 lives the game ends (`state = 'over'`).
- **Level complete:** colouring the final cube sets `state = 'won'`; continuing
  starts the next level (`level + 1`) with a fresh pyramid and faster enemies.
- **Best score** is persisted in `localStorage`.

## Controls

Q\*bert uses the classic 45°-rotated joystick mapping, so each arrow key is one
diagonal hop:

| Input                | Hop        |
|----------------------|------------|
| Arrow Up / W         | up-right   |
| Arrow Right / D      | down-right |
| Arrow Down / S       | down-left  |
| Arrow Left / A       | up-left    |
| P                    | pause / resume |
| Any hop key (idle)   | start      |
| Any key (game over)  | play again |

## States

`idle` → `running` ⇄ `paused`, with terminal `over` and transitional `won`
(level cleared, press to continue). A movement key while `idle` starts the game;
any key while `over` restarts; any key while `won` advances to the next level.

## Assumptions

These were left ambiguous by the brief; the simpler interpretation was chosen and
recorded here:

- **Single colour stage per level.** The arcade later required two hops per cube
  (and had cubes that toggle). Here one hop colours a cube permanently for the
  level; higher levels simply add faster/more frequent enemies.
- **Only the red "ball" enemy** is implemented — no Coily the snake, no Ugg/
  Wrong-Way, no green Slick/Sam, and no flying discs. This keeps enemy behaviour
  simple and the core hopping/colouring loop clearly testable.
- **The apex cube starts coloured** because Q\*bert spawns standing on it; it
  counts toward the 28 needed but scores no points.
- **Enemy spawning is time-based** and can be suspended in tests via the global
  `autoSpawn` flag, so deterministic hopping/colouring tests never race a ball.
- **Hops are instantaneous in game logic** (`qbert.r`/`qbert.c` update on the
  key press); the little jump arc is a purely visual tween that never affects
  state or collisions.
