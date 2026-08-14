# Lode Runner

A dig-and-climb arcade platformer on an HTML5 canvas. You are dropped into a
scaffold of brick floors, ladders and hand-over-hand ropes, with gold scattered
through it and guards patrolling every floor. You cannot jump and you cannot
fight — your only tool is a shovel that blasts a hole in the brick beside you.
Collect every piece of gold and the hidden escape ladders light up to the top of
the screen.

![Lode Runner](screenshot.png)

## Playing

Open `index.html` in any modern browser. No build step and no server required.

## Controls

| Input | Action |
|---|---|
| `←` `→` / `A` `D` | run left / right |
| `↑` `↓` / `W` `S` | climb a ladder, or drop off a rope |
| `Z` or `,` | dig down-left |
| `X` or `.` | dig down-right |
| `Space` / `Enter` | start / restart |
| `P` | pause / resume |

## How to play

**Collect the gold.** Every piece is worth 250. Clear the board and the escape
ladders — invisible until then — appear; climb to the very top row to finish the
level for another 1500 points.

**Dig your way around.** `Z` and `X` blast the brick diagonally below you. The
hole is your route down through a floor: you drop straight through it. You have
to be standing on firm ground to dig — not on a ladder, not hanging from a rope,
not mid-fall — and grey bedrock never yields.

**Trap the guards.** A guard that walks into an open hole is stuck in it (75
points) and hauls itself out about three seconds later. Bricks knit themselves
back together after five seconds, so a guard still in the hole when it closes is
crushed for 150 — but time it badly and the same brick closing around *you*
costs a life. You have three.

**Chase your gold down.** Guards pick up any gold they cross and carry it
around, so the last piece on the board is often in a guard's pocket. Trap them
and they drop it on the lip of the hole.

**Ropes and ladders.** Ladders carry you up and down; ropes only carry you
sideways — press down to let go. Falling, you pass straight through a rope but
land on a ladder.

Three levels ship with the game. After the third it cycles back around with
faster guards, so a run is endless and the score is the point.

## Scoring

| Event | Points |
|---|---|
| Gold collected | 250 |
| Guard trapped | 75 |
| Guard crushed | 150 |
| Level cleared | 1500 |

Your best score is remembered in `localStorage`.

## Development

`DESIGN.md` explains the tile grid, the grid-locked movement model, the digging
rules and the guards' pathfinding, and records the assumptions made while
building it.

Tests are Playwright specs in `tests/`:

```powershell
npx playwright test LodeRunner/tests/
```

All motion is expressed in tiles per second and advanced through `step(dt)`, so
the specs simulate frames deterministically rather than waiting on wall-clock
time.
