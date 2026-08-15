# Tank Battle

A Battle City style base-defence shooter. Waves of enemy tanks roll in from the
top of a 13 x 13 battlefield, all of them hunting the eagle in the brick
fortress at the bottom. You have one tank and three lives to stop them.

![Tank Battle](screenshot.png)

## Playing

Open `index.html` in a browser — no build step or server required.

## Controls

| Input | Action |
|---|---|
| Arrow keys / WASD | Drive |
| Space | Fire |
| P | Pause / resume |
| Space | Start a new battle from the title or game-over screen |

## How it works

- Destroy every tank in the wave to advance a level. Waves grow from 8 tanks to
  20, and later waves mix in fast and armoured tanks.
- At most four enemy tanks are on the field at once, so the pressure comes in
  bursts.
- **The eagle is the game.** One shell reaching it ends the battle instantly —
  including one of your own, so mind what is behind your target.
- Terrain matters:
  - **Brick** blocks tanks and is destroyed by a shell — tunnel your own routes.
  - **Steel** blocks tanks and shells alike.
  - **Water** blocks tanks but shells fly straight over it.
  - **Trees** hide whatever drives underneath them, you and the enemy both.
- Getting hit costs a life and respawns you with a brief shield.
- Enemy tanks are worth 100 (basic), 200 (fast) or 300 (armoured) points. Your
  best score is remembered in the browser.

## Tips

- Two rows of brick guard the eagle. Never shoot them out yourself — that is
  the wall doing your job for you.
- Shells cancel each other out head-on, which is often safer than dodging.
- Trees are the best ambush spot on the map; enemies cannot see you in there
  either.

## Tests

From the repository root:

```powershell
npx playwright test TankBattle/tests/
```
