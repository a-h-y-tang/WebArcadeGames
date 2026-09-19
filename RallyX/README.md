# Rally-X

A scrolling maze rally. Collect every flag on the course before your fuel runs
dry, while red cars hunt you through the same maze. Your only defence is the
smoke screen — a puff of exhaust that spins out any chaser that drives into it.

![Rally-X](screenshot.png)

## Playing

Open `index.html` in a browser. No build step and no server needed.

## Controls

| Key | Action |
|---|---|
| Arrow keys / WASD | Steer |
| Space | Drop smoke (also starts or restarts the game) |
| P / Esc | Pause |

## How it works

* The course is bigger than the screen. The left 440 px of the canvas is a
  viewport that scrolls with your car; the panel on the right is a **radar**
  showing the whole course — every flag, every chaser and the patch you are
  currently looking at.
* **Flags** are worth 100 points. One flag per course is a golden **x2 flag**:
  it scores like a normal flag and then doubles every flag you collect after
  it for the rest of the round.
* **Fuel** drains as you drive and each smoke screen costs a little more.
  Running dry costs a car, exactly like being caught.
* **Smoke** lingers for 2.5 seconds. A chaser that touches it spins out for
  three seconds: it stops dead and is harmless, so you can drive straight
  through it.
* Clearing every flag loads the next course and pays a bonus of 10 points for
  each unit of fuel left in the tank. Three courses cycle, with more and
  faster chasers each level.
* Losing a car puts everyone back on their spawns and refills the tank, but
  the flags you have already collected stay collected.

Your best score is kept in `localStorage`.

## Tests

From the repo root:

```powershell
npx playwright test RallyX/tests/
```

The suite drives the simulation directly through `step(dt)` with
`setAutoStep(false)`, so nothing depends on frame timing. It covers driving and
wall collision, flags and the x2 flag, the smoke screen and spin-outs, chaser
pursuit, fuel, lives, pausing, game over and the scrolling camera — and it
flood-fills every built-in course to prove no flag can be stranded behind a
wall.

See [DESIGN.md](DESIGN.md) for how the code is organised.
