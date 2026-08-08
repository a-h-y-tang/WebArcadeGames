# Defender

A scrolling-world arcade shooter. Patrol a planet four screens wide, shoot the
landers before they can carry your colonists into orbit, and catch anyone who
gets dropped.

![Defender](screenshot.png)

## How to play

Open `index.html` in any modern browser — no build step, no server.

Press **Space** (or click **Start Game**) to launch.

## Controls

| Input             | Action                      |
|-------------------|-----------------------------|
| ← / A , → / D     | Thrust and turn             |
| ↑ / W , ↓ / S     | Climb / dive                |
| Space             | Fire                        |
| B                 | Smart bomb                  |
| H                 | Hyperspace                  |
| P                 | Pause / resume              |

## The game

- Ten **humanoids** (yellow) stand on the terrain. Green **landers** descend,
  grab one and climb. A lander that reaches the top of the screen kills its
  captive and becomes a magenta **mutant** that hunts *you*.
- Shoot a carrying lander and its humanoid falls. Fly into it to catch it, then
  fly low over the ground to set it down — **500 points**. Let it fall from
  height and it dies on impact.
- The **scanner** across the top shows the whole planet, centred on your ship:
  yellow marks humanoids, green landers, magenta mutants, and the box is the
  part of the world you can currently see. Most of the game is played off the
  visible screen, so read the scanner.
- **Smart bombs** (`B`) wipe out everything within half a screen. You start
  with three and earn one per wave, up to six.
- **Hyperspace** (`H`) jumps you across the planet on a 3-second cooldown —
  your escape hatch when mutants close in.
- Lose every humanoid and the planet falls: every remaining lander mutates at
  once.

## Scoring

| Event                                      | Points |
|--------------------------------------------|--------|
| Lander destroyed                           | 150    |
| Mutant destroyed                           | 150    |
| Humanoid returned to the ground            | 500    |
| Each humanoid alive when a wave is cleared | 100    |

Three ships. Your best score is saved in the browser.

## Tests

```powershell
npx playwright test Defender/tests/
```

See [DESIGN.md](DESIGN.md) for how the code works.
