# Battleship — Design

## Concept

The classic two-player naval guessing game, played against a computer opponent.
You place a fleet of five ships on your 10×10 grid, then you and the CPU take
turns firing single shots at each other's hidden grids. Every shot is a hit or a
miss; sink a ship by hitting all of its cells. Sink the enemy's whole fleet
before it sinks yours to win.

## The boards

Two 10×10 grids sit side by side on a `660 × 360` canvas (`30px` cells):

- **Enemy waters** (left) — where you fire. The enemy fleet is hidden; your
  shots show as hit (red) or miss (white), and a ship is revealed once sunk.
- **Your fleet** (right) — your ships are visible; the CPU's shots land here.

## The fleet

Five ships, 17 cells in total:

| Ship        | Size |
|-------------|------|
| Carrier     | 5    |
| Battleship  | 4    |
| Cruiser     | 3    |
| Submarine   | 3    |
| Destroyer   | 2    |

## Flow / state machine

`idle → placing → playing → over`

1. **placing** — the enemy fleet is auto-placed at random; you place yours by
   clicking your grid (press `R` to rotate horizontal/vertical), or hit
   **Randomize** to auto-place the rest. A placement is rejected if it runs off
   the board or overlaps another ship. Once all five are down, battle begins.
2. **playing** — click a cell in enemy waters to fire. Your shot resolves
   (miss / hit / sunk); if that sank the enemy's last ship you win immediately.
   Otherwise the CPU takes one shot at your fleet. If it sinks your last ship,
   you lose.
3. **over** — a win/lose overlay; `Space`/`Enter`/button starts a fresh game.

The **best score** is the fewest shots you've ever needed to win, persisted to
`localStorage` (`battleship-best`).

## The core logic (all deterministic & pure)

- `canPlace(board, size, r, c, orient)` / `placeShip(...)` — bounds + overlap
  validation, then commit the ship's cells to the grid.
- `fireAt(board, r, c)` — returns `{result: 'hit'|'miss', sunk}` (or `null` for
  an out-of-bounds or repeated shot); a ship is *sunk* when its hit count
  reaches its size.
- `isFleetSunk(board)` — the whole fleet is down.

Because these are pure functions of the board state — no wall-clock time — the
Playwright tests set up an exact board and assert on the result.

## The CPU (deterministic — no `Math.random` in the shot logic)

The opponent uses classic **hunt / target**:

- **Target mode:** after a non-sinking hit, the four orthogonal neighbours are
  queued; the CPU fires those (skipping already-shot cells) to finish the ship.
- **Hunt mode:** with an empty queue, it fires at the first un-shot cell on a
  **checkerboard parity** (`(r + c)` even) in reading order, falling back to any
  un-shot cell. Parity guarantees it can't miss a ship of length ≥ 2 while
  searching, and firing at most every other cell.

The only randomness in the whole game is the *placement* of fleets
(`autoPlace`, `Math.random`), which lives entirely outside the shot logic, so
every firing sequence is reproducible under test.

## Controls

| Action                 | Input                                  |
|------------------------|----------------------------------------|
| Place ship / fire      | Click the relevant grid                |
| Rotate ship (placing)  | `R`                                    |
| Randomize your fleet   | **Randomize** button                   |
| Start / restart        | `Space` / `Enter` / button             |

## Assumptions

Simpler interpretation chosen throughout, per the brief:

- **Single shot per turn** (not salvo, not extra-turn-on-hit). Keeps the
  turn loop simple and symmetric.
- **No pause control** — Battleship is turn-based with no real-time clock, so
  pause adds nothing (same choice the repo's 2048 made).
- The CPU's shot selection is fully deterministic (parity hunt + neighbour
  target) rather than probabilistic density mapping — competent, and
  reproducible for tests.
- **Best = fewest shots to win** (lower is better), rather than a points total.
- A fixed `660 × 360` canvas holding both 10×10 grids side by side.
