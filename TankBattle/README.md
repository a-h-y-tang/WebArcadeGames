# Tank Battle

A top-down armoured skirmish on an HTML5 canvas, inspired by the arcade classic
*Battle City*. Defend the eagle at the bottom of the map while wiping out every
enemy tank that rolls in from the top.

![Tank Battle](screenshot.png)

## How to play

Open `index.html` in a browser — no build step or server required.

Press **Space** (or click **Start Game**) to roll out.

| Input                       | Action                        |
|-----------------------------|-------------------------------|
| ← ↑ ↓ → / W A S D           | Drive the tank                |
| Space                       | Fire (also starts / restarts) |
| P                           | Pause / resume                |

## Rules

- **Kill the quota.** Every level has a fixed number of enemy tanks to destroy.
  They arrive from three spawn points along the top edge, a few at a time. The
  HUD's **Enemies** counter shows how many are still left to kill.
- **Defend the eagle.** The base sits behind a brick fort at the bottom centre.
  If *any* shell reaches it — yours included — the game is over on the spot, no
  matter how many lives you have left.
- **Terrain.** Brick walls crumble to a single shell, so you can tunnel new
  routes (and so can the enemy — watch your fort). Steel walls are
  indestructible and stop shells dead.
- **One shell at a time.** You can only have a single shell in flight, so a
  missed shot leaves you defenceless for a moment. Enemy tanks are under the same
  restriction.
- **Lives.** You start with three tanks. A destroyed tank rolls back out from the
  spawn point after a moment with a brief shield. Lose the last one and the war
  is over.
- **Score.** Each kill is worth `100 × level`. Clearing a level keeps your score
  and lives, rebuilds the battlefield, and makes the enemy faster, more numerous
  and quicker on the trigger. Your best score is remembered in the browser.

## Tips

- Corners are safe: turning snaps you onto the lane centre, so you can duck
  behind a brick block and pop out to fire.
- Keep the fort intact. Shooting your own bricks opens a lane straight to the
  eagle.
- Enemies favour the base over you. If several get past, cut back and defend
  rather than trading shots in the open field.

## Development

Tests live in `tests/` and run with the repo's Playwright setup:

```powershell
npx playwright test TankBattle/tests/
```

See [DESIGN.md](DESIGN.md) for how the code is put together.
