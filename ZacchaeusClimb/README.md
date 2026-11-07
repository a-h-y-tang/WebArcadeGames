# Zacchaeus Climb

*"He wanted to see who Jesus was, but because he was short he could not see over
the crowd. So he ran ahead and climbed a sycamore-fig tree to see him."*
— Luke 19:3-4

An endless vertical jumper on an HTML5 canvas. Zacchaeus bounces forever — you
just steer left and right. Land on the branches of the sycamore tree to keep
climbing; the higher you go, the higher your score. Miss and fall off the
bottom, and it's over.

![Zacchaeus Climb](screenshot.png)

## How to play

Open `index.html` directly in a browser — no build step or server needed.

### Controls

| Action | Keys |
|---|---|
| Steer left / right | **←** / **→** or **A** / **D** |
| Start | **Space**, **←**, **→**, **A**, **D**, or the **Start** button |
| Pause / resume | **P** |

### Rules

- Zacchaeus bounces automatically. Every bounce reaches the same height, so
  the game is all about steering onto the next platform.
- Move off one edge of the screen to **wrap around** to the other side.
- Branches come in three kinds:
  - **Dark green leaves** — normal, solid, static.
  - **Light green leaves** — solid but sways sideways, reversing at the walls.
  - **Bare brown twig** — snaps the instant you touch it: no bounce, you fall straight
    through. A safe leafy branch is always generated alongside it, so a
    break is a trap to avoid, never a dead end.
- The world scrolls only once you climb past the camera line (40% from the
  top). **Your score is the total height climbed**, in pixels, and it never
  goes down.
- Falling below the bottom of the screen ends the run.
- Your best score is saved in the browser via `localStorage`.

## Files

| File | Purpose |
|---|---|
| `index.html` | Page markup, canvas, and HUD |
| `style.css` | Styling and the start / pause / game-over overlay |
| `game.js` | Game logic, physics, platform generation, rendering, and input |
| `DESIGN.md` | Design notes: concept, mechanics, and assumptions |
| `tests/zacchaeus-climb.spec.js` | Playwright test suite |

## Development

From the repository root:

```powershell
npm install
npx playwright test ZacchaeusClimb/tests/
```

See the root [README](../README.md) for full setup instructions.
