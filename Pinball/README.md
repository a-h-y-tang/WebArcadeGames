# Pinball

A classic single-table **Pinball** game built with the HTML5 canvas — launch
the steel ball, keep it alive with two flippers, and rack up points off the
bumpers. No build step: open `index.html` in any modern browser.

## How to play

1. Click **Start Game** (or press any key).
2. Press **Space** (or **Up arrow**) to launch the ball from the plunger lane.
3. Use the flippers to bat the ball back up the table and keep it out of the
   drain between them.
4. Every bumper you hit adds its point value to your score.
5. You start with **3 balls**. When the last one drains, the game is over.
   Your best score is saved between sessions.

## Controls

| Action | Keys |
|---|---|
| Launch ball | `Space` / `↑` |
| Left flipper | `←` / `Z` / `A` |
| Right flipper | `→` / `/` / `L` |
| Start / Restart | click **Start** or press any key |

Hold a flipper key to keep that flipper raised; release to let it drop.

## Scoring

- Top bumpers: **100** points each.
- Lower bumper: **50** points.
- Aim to keep the ball in play as long as possible — more bounces, more points.

## Under the hood

The whole game is one canvas and a small fixed-step physics loop: gravity plus
reflection off line segments (walls, flippers) and circles (bumpers), with a
speed cap to prevent tunnelling. See [design.md](design.md) for the full
breakdown of the geometry, collision maths, and exposed API.

## Tests

Playwright tests live in [`tests/`](tests/) and cover initial state, launching,
gravity, wall/bumper/flipper collisions, draining and lives, scoring, the best
score, and restarting.

```bash
npx playwright test Pinball/tests/
```
