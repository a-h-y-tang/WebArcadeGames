# Berzerk

A maze shoot-'em-up on an HTML5 canvas, inspired by the 1980 arcade classic.

You are a lone humanoid trapped in an endless series of robot-patrolled maze
rooms. Shoot the robots, dodge their fire, and escape through a doorway before
**Evil Otto** — an indestructible bouncing smiley that drifts straight through
walls — catches up with you.

## Playing

Open `index.html` in any modern browser. No build step or server required.

## Controls

| Input                     | Action                          |
|---------------------------|---------------------------------|
| ← ↑ ↓ → / W A S D         | Move (eight directions)         |
| Space                     | Shoot in the direction you face |
| Space / Enter             | Start or restart                |
| P                         | Pause / resume                  |

## Rules

- Each room is a freshly generated maze with four doorways: left, right, top and
  bottom. Walking out of any doorway takes you to the next room.
- Only **one bullet at a time** may be in flight, so make it count.
- **50 points** per robot you shoot. Robots destroyed by another robot's stray
  fire score nothing.
- Leave a room with every robot destroyed for a **100-point clearance bonus**.
- You lose a life if a robot touches you, a robot bullet hits you, or Evil Otto
  reaches you. Your own bullets are harmless to you.
- Otto arrives 20 seconds into a room — or just 5 seconds after the last robot
  dies. He cannot be shot. Keep moving.
- Three lives. Later rooms hold more robots, faster robots and denser mazes.
  Your best score is saved in the browser.

## Tests

From the repository root:

```powershell
npx playwright test Berzerk/tests/
```

## How it works

See [DESIGN.md](DESIGN.md) for the maze generation, collision model, robot AI
and the deterministic-simulation approach the tests rely on.
