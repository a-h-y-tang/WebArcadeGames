# 8-Ball Pool

A two-player hot-seat game of 8-ball on a top-down pool table, built with plain
HTML5 canvas and JavaScript — no build step, no dependencies. Line up the cue,
charge the shot and break; the first player to legally pot an object ball takes
that group, and the first to clear their seven and sink the 8 ball wins.

![8-Ball Pool screenshot](screenshot.png)

## How to play

Open `index.html` in any modern browser. Press **Space** (or click **Start
Game**) to rack up.

| Input | Action |
|---|---|
| Mouse move | Aim — the cue points from the cue ball toward the pointer |
| Hold mouse button | Charge power, release to shoot |
| Space (hold) | Charge power, release to shoot |
| ← / → | Fine-tune the aim angle |
| ↑ / ↓ | Nudge the power up / down |
| R | Re-rack |
| Space (idle / game over) | Start or rematch |

### Rules

- The table starts **open**. The first player to legally pot an object ball is
  assigned that group — **solids** (1–7) or **stripes** (9–15) — and the other
  player gets the rest.
- Pot one of your own balls and you shoot again. Otherwise the turn passes.
- It's a **foul** if you pot the cue ball, hit nothing at all, or the first ball
  you strike is not one of yours (the 8 ball counts as yours only once your
  group is clear). A foul respots the cue ball on the head spot and hands the
  table to your opponent.
- Clear all seven of your balls, then pot the **8 ball** to win. Potting the 8
  before your group is clear — or on a foul — loses the game immediately.

The dashed guide line shows where the cue ball is headed, and the cue stick
pulls back as your power builds. The panel above the table tracks each player's
group and how many balls they have left.

## Development

8-Ball Pool follows the repo-wide test setup. From the repository root:

```powershell
npm install
npx playwright install chromium
npx playwright test Pool/tests/
```

See [DESIGN.md](DESIGN.md) for how the physics, the rules engine and the
deterministic test harness fit together.
