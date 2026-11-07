# Locust Swarm

*"I will repay you for the years the locusts have eaten."* — Joel 2:25

A swarm of locusts descends on the harvest. The swarm marches side to side and
creeps down toward the wheat; you carry a farmer's smoke pot along the bottom
and puff smoke upward to drive the locusts off before they land — and they drop
chewed husks back on you.

**Status: Complete**

## How to play

Open `index.html` in any modern browser — no build step or server required.
Press **Space** or an arrow key to launch.

| Action           | Keys                   |
|------------------|------------------------|
| Move left        | `←` / `A`              |
| Move right       | `→` / `D`              |
| Puff smoke       | `Space`                |
| Pause / Resume   | `P`                    |
| Start / Restart  | `Space` / an arrow key |

## Rules

- The whole swarm moves as one block, reversing direction and dropping a row each
  time it reaches a wall. It **speeds up as you thin it out**, and starts faster
  on each later wave.
- You may have at most **3 puffs of smoke** in flight at once, so aim rather than spray.
- Locusts score by height: **top row = 30**, **middle rows = 20**,
  **bottom rows = 10**.
- The swarm drops chewed husks. A husk hitting your smoke pot costs one of your
  **3 lives**.
- If any locust reaches your row, the swarm has **landed** on the harvest and the game ends
  immediately, however many lives you have left.
- Drive off every locust to advance to the next, faster wave.
- Your best score is saved between sessions in your browser.

## Under the hood

The whole game is one `<canvas>` driven by a small state machine
(`idle → running → paused → over`). Simulation runs through a single
frame-rate-independent `step(dt)` function measured in pixels per millisecond.
See [DESIGN.md](DESIGN.md) for the full write-up and the assumptions made.

## Tests

Playwright drives the game end-to-end — smoke-pot movement and clamping, firing and
the shot cap, the marching/reversing/dropping swarm, invader destruction and
scoring, alien fire, lives and the two loss conditions (bombed out vs. swarm
landing), wave progression, pause, and game-over/best-score persistence.

```powershell
npx playwright test LocustSwarm/tests/
```
