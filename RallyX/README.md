# Rally-X

A top-down maze driving game. Sweep every flag out of a scrolling maze while red
chase cars hunt you down — and dump smoke to spin them out when they get close.

![Rally-X](screenshot.png)

## Playing

Open `index.html` in any browser. No build step, no server.

## Controls

| Input | Action |
|---|---|
| Arrow keys / `WASD` | Steer |
| `Space` | Start · drop a smoke screen |
| `P` | Pause / resume |

## How it works

* **Flags.** Eight flags are hidden in each maze. Drive over one to bank 100
  points. One of them is the purple **special flag** — grab it early and every
  flag you collect afterwards is worth double.
* **Chase cars.** Two red cars start in the far corners and path through the
  maze straight at you; a third joins on level 2, up to five. They are slower
  than you and only pick a new direction at tile centres, so tight corners are
  your friend. One touch wrecks you.
* **Smoke screen.** `Space` dumps a cloud behind your car for 6 fuel. Any
  chaser that drives into it spins out for three seconds — long enough to grab
  the flag it was guarding.
* **Fuel.** The tank burns steadily while you drive and pays out `10 x` whatever
  is left when you clear the level. Run it dry and you wreck the car, so the
  smoke you spend is a real trade.
* **Radar.** The panel on the right shows the whole maze at once: your car, the
  flags still out there, the chasers, and the slice of the world currently on
  screen.

Clearing every flag rolls into the next level: a fresh maze, a full tank and one
more car on your tail. You get three cars; the best score is kept in the
browser.

## Development

The design notes are in [DESIGN.md](DESIGN.md). Tests are Playwright specs in
`tests/`:

```powershell
npx playwright test RallyX/tests/
```
