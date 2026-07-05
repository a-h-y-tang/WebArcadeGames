# Space Invaders

A browser remake of the 1978 arcade landmark. A grid of aliens marches side to
side and creeps downward; you command a laser cannon along the bottom and shoot
upward to clear the swarm before it lands on you — and it shoots back.

**Status: Complete**

## How to play

Open `index.html` in any modern browser — no build step or server required.
Press **Space** or an arrow key to launch.

| Action           | Keys                   |
|------------------|------------------------|
| Move left        | `←` / `A`              |
| Move right       | `→` / `D`              |
| Fire             | `Space`                |
| Pause / Resume   | `P`                    |
| Start / Restart  | `Space` / an arrow key |

## Rules

- The whole swarm moves as one block, reversing direction and dropping a row each
  time it reaches a wall. It **speeds up as you thin it out**, and starts faster
  on each later wave.
- You may have at most **3 shots** in flight at once, so aim rather than spray.
- Invaders score by height: **top row = 30**, **middle rows = 20**,
  **bottom rows = 10**.
- The swarm drops bombs. A bomb hitting your cannon costs one of your **3 lives**.
- If any invader reaches your row, the swarm has **landed** and the game ends
  immediately, however many lives you have left.
- Clear every invader to advance to the next, faster wave.
- Your best score is saved between sessions in your browser.

## Under the hood

The whole game is one `<canvas>` driven by a small state machine
(`idle → running → paused → over`). Simulation runs through a single
frame-rate-independent `step(dt)` function measured in pixels per millisecond.
See [DESIGN.md](DESIGN.md) for the full write-up and the assumptions made.

## Tests

Playwright drives the game end-to-end — cannon movement and clamping, firing and
the shot cap, the marching/reversing/dropping swarm, invader destruction and
scoring, alien fire, lives and the two loss conditions (bombed out vs. swarm
landing), wave progression, pause, and game-over/best-score persistence.

```powershell
npx playwright test SpaceInvaders/tests/
```
