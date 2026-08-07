# Marble Loop

A Zuma-style marble shooter. A chain of coloured marbles winds along a spiral
track towards the hole at its centre. You sit in the middle with a launcher —
fire marbles into the chain, line up three or more of a colour to blow them
away, and clear the whole level before the leading marble drops into the hole.

![Marble Loop](screenshot.png)

## Playing

Open `index.html` in any browser. No build step, no server.

## Controls

| Input | Action |
|---|---|
| Mouse move | Aim the launcher |
| Click / tap the board | Fire |
| <kbd>←</kbd> <kbd>→</kbd> | Rotate the launcher |
| <kbd>Space</kbd> | Start the game / fire while playing |
| <kbd>S</kbd> | Swap the loaded marble with the next one |
| <kbd>P</kbd> | Pause / resume |
| <kbd>R</kbd> | Restart |

## Rules

- Marbles feed onto the track from the outer end of the spiral and roll steadily
  towards the hole in the centre.
- A shot marble wedges into the chain wherever it lands. Three or more of the
  same colour touching each other are destroyed.
- When a group is destroyed the chain closes the gap. If that brings two more
  matching groups together they go too — a **combo**, and each step of the
  combo is worth more than the last.
- Scoring is `10 × marbles destroyed × combo step`, so a three-deep cascade is
  worth far more than three separate shots.
- Clear every marble in the level — the ones on the track *and* the ones still
  waiting to enter — to move on and bank a `500 × level` bonus.
- The track flashes red when the chain gets close to the hole. If the leading
  marble reaches it, the game is over.
- Each level adds marbles and speed, and every second level adds a colour (up
  to six).
- The launcher only ever hands you a colour that is still somewhere in the
  level, so you can never be given a dead marble.

Your best score is kept in the browser's local storage.

## Files

| File | Purpose |
|---|---|
| `index.html` | HUD, canvas and overlay markup |
| `style.css` | Dark arcade styling |
| `game.js` | Path building, chain simulation, matching, rendering, input |
| `tests/marble-loop.spec.js` | Playwright specs |
| `DESIGN.md` | How the code works, and the assumptions behind it |

## Tests

From the repository root:

```powershell
npx playwright test MarbleLoop/tests/
```
