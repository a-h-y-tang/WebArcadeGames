# Rally-X

A top-down maze driving game on an HTML5 canvas. You are a blue rally car loose
in a maze that is bigger than the screen: ten flags are scattered across it, and
three red chase cars are already looking for you. Collect every flag to clear
the round. The tank drains the whole time, and your only defence is the smoke
screen trailing out of the back of the car.

![Rally-X](screenshot.png)

## Playing

Open `index.html` in any modern browser. No build step and no server required.

## Controls

| Input | Action |
|---|---|
| `←` `↑` `↓` `→` / `WASD` | steer |
| `Space` | drop a smoke screen (also starts the game when idle or after game over) |
| `Enter` | start / resume |
| `P` | pause / resume |

## How to play

**Collect the flags.** Ten yellow flags are laid out across the maze, and the
round ends when you have taken them all. The play area is a 480 × 384 window on
a 608 × 480 maze, so most of the flags are off-screen: the radar panel on the
right shows the whole maze at once — flags in yellow, chase cars in red, you in
blue, and the outlined box is the part you can currently see.

**Steer early.** The car follows the corridor it is in and takes your turn at
the next junction that is open in that direction, so you can press ahead of a
corner. A reversal happens the moment you press it. Drive into a wall and the
car stops there until you steer it out; the maze has no dead ends, so there is
always a way through.

**The chase cars.** They head for you on the shortest route through the maze,
and each one aims a few cells to a different side of you so the pack spreads out
and tries to cut you off rather than following in a queue. Touching one costs a
car; you start with three. Each round adds another chase car up to five, and
they get a little faster — but never as fast as a fuelled player car.

**Smoke them.** `Space` leaves a cloud of smoke where you are for four seconds
and costs 6 fuel. Any chase car that drives into it spins out for three seconds:
harmless, motionless and easy to drive around. The cloud is not used up by a
hit, so a cloud dropped in a tight corridor can stop a whole pack at once.

**Watch the fuel.** The gauge drains for the whole round. An empty tank does not
end the round — but the car drops to just over half speed, which is slower than
the chase cars, so the last few flags become a real problem. Every round starts
with a full tank.

**The lucky flag.** One flag per round is green and marked `S`. Taking it doubles
the value of every flag you collect afterwards in that round, so it is worth
planning a route that reaches it early.

## Scoring

| Event | Points |
|---|---|
| Flag | 100 × multiplier |
| Lucky flag (green `S`) | 100 × multiplier, then doubles the multiplier |
| Round cleared | 10 × each whole unit of fuel left in the tank |

Your best score is remembered in `localStorage`.

## Development

`DESIGN.md` explains the coordinate systems, the maze construction, the
grid-aligned movement model and the chase-car AI, and records the assumptions
made while building it.

Tests are Playwright specs in `tests/`:

```powershell
npx playwright test RallyX/tests/
```

All motion is expressed per-second and advanced through `step(dt)`, and the
tests switch off the `requestAnimationFrame` driver with `setAutoStep(false)`,
so the specs simulate frames deterministically rather than waiting on
wall-clock time.
