# Battleship

The classic naval guessing game against a computer opponent. Place your fleet of
five ships, then trade single shots with the CPU across two hidden 10×10 grids.
Every shot is a **hit** or a **miss**; hit all of a ship's cells to **sink** it.
Sink the enemy's entire fleet before it sinks yours to win.

## How to play

1. **Start** → the enemy fleet is hidden and placed at random; you place yours.
2. **Place** each ship by clicking your grid (right). Press `R` to rotate between
   horizontal and vertical. Or click **Randomize Fleet** to auto-place. A ship
   can't run off the board or overlap another.
3. **Fire** by clicking a cell in *enemy waters* (left). Your shot resolves, then
   the CPU takes one shot at your fleet. Sunk ships are revealed.

The fleet: Carrier (5), Battleship (4), Cruiser (3), Submarine (3), Destroyer (2)
— 17 cells in all. Your **best score** is the fewest shots you've ever needed to
win, saved between sessions.

## Playing

Open `index.html` directly in a browser — no build step or server required.

## The CPU

A deterministic **hunt / target** opponent: it searches on a checkerboard parity
(so it can't skip past a ship), and the moment it lands a hit it switches to
firing the neighbouring cells until the ship is sunk. No randomness lives in its
shot logic — only fleet placement is random — so any firing sequence is
reproducible under test.

See [DESIGN.md](DESIGN.md) for the full design, mechanics, and assumptions.

## Tests

Playwright tests live in `tests/`. From the repo root:

```powershell
npx playwright test Battleship/tests/
```
