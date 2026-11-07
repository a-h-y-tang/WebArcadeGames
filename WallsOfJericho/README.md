# Walls of Jericho

*"When the trumpets sounded, the army shouted, and at the sound of the trumpet,
when the men gave a loud shout, the wall collapsed."* — Joshua 6:20

A brick-breaker built on an HTML5 canvas. Joshua's people marched around
Jericho for seven days; now it is your turn. Bounce the trumpet blast off the
priest's ram's-horn trumpet to knock down every stone of the city wall. Bring
down the whole wall to advance to a faster level. Miss the blast and you lose a
life — lose all three and it's game over.

## How to play

Open `index.html` directly in a browser — no build step or server needed.

### Controls

| Action | Keys |
|---|---|
| Move trumpet | **←** / **→**, **A** / **D**, or move the **mouse** over the canvas |
| Start / launch | **Space**, **←**, **→**, **A**, **D**, or the **Start** button |
| Pause / resume | **P** |

### Rules

- The blast reflects off the side and top walls, the trumpet, and stones.
- Where the blast hits the trumpet steers its bounce: hit the edge to send it
  sideways, hit the centre to send it straight up.
- Each stone is destroyed in one hit. Higher rows are worth more points
  (top row 50, down to 10 for the bottom row).
- Clearing every stone starts the next level with a faster blast.
- Letting the blast fall past the trumpet costs a life. You start with 3.
- Your best score is saved in the browser via `localStorage`.

## Files

| File | Purpose |
|---|---|
| `index.html` | Page markup, canvas, and HUD |
| `style.css` | Styling and the start / pause / game-over overlay |
| `game.js` | Game logic, physics, rendering, and input |
| `DESIGN.md` | Design notes: concept, mechanics, and assumptions |
| `tests/walls-of-jericho.spec.js` | Playwright test suite |

## Development

From the repository root:

```powershell
npm install
npx playwright test WallsOfJericho/tests/
```

See the root [README](../README.md) for full setup instructions.
