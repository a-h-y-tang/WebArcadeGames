# Breakout

A classic brick-breaker built on an HTML5 canvas. Bounce the ball off your
paddle to smash every brick in the wall. Clear the wall to advance to a
faster level. Miss the ball and you lose a life — lose all three and it's
game over.

## How to play

Open `index.html` directly in a browser — no build step or server needed.

### Controls

| Action | Keys |
|---|---|
| Move paddle | **←** / **→**, **A** / **D**, or move the **mouse** over the canvas |
| Start / launch | **Space**, **←**, **→**, **A**, **D**, or the **Start** button |
| Pause / resume | **P** |

### Rules

- The ball reflects off the side and top walls, the paddle, and bricks.
- Where the ball hits the paddle steers its bounce: hit the edge to send it
  sideways, hit the centre to send it straight up.
- Each brick is destroyed in one hit. Higher rows are worth more points
  (top row 50, down to 10 for the bottom row).
- Clearing every brick starts the next level with a faster ball.
- Letting the ball fall past the paddle costs a life. You start with 3.
- Your best score is saved in the browser via `localStorage`.

## Files

| File | Purpose |
|---|---|
| `index.html` | Page markup, canvas, and HUD |
| `style.css` | Styling and the start / pause / game-over overlay |
| `game.js` | Game logic, physics, rendering, and input |
| `DESIGN.md` | Design notes: concept, mechanics, and assumptions |
| `tests/breakout.spec.js` | Playwright test suite |

## Development

From the repository root:

```powershell
npm install
npx playwright test Breakout/tests/
```

See the root [README](../README.md) for full setup instructions.
