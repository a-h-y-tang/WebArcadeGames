# Q*bert

An HTML5 Canvas re-creation of the 1982 arcade classic **Q\*bert**. Hop the
little orange fellow around an isometric pyramid of 28 cubes, changing the colour
of every cube to clear the level — while dodging the edges and the red enemy
balls bouncing down toward you.

## How to Play

Open `index.html` in any modern browser — no build step, no dependencies.

Q\*bert hops **diagonally**, so each arrow key moves you toward one corner of the
cube you're standing on (the classic 45°-rotated joystick):

| Input            | Hop        |
|------------------|------------|
| Arrow Up / W     | up-right   |
| Arrow Right / D  | down-right |
| Arrow Down / S   | down-left  |
| Arrow Left / A   | up-left    |
| P                | pause / resume |

**Objective:** colour all 28 cubes by landing on them. Each freshly coloured cube
scores **25** points. Colour them all to complete the level and move on to a
faster one.

**Watch out:**

- **The edges.** Hop off the side of the pyramid and you fall — that costs one of
  your **3 lives**. You respawn on the top cube; the cubes you've already coloured
  stay coloured.
- **Red balls.** They spawn near the top and bounce downward. Share a cube with
  one — by hopping into it or letting it land on you — and you lose a life.

Lose all three lives and it's game over. Your best score is saved between plays.

## Files

| File | Purpose |
|------|---------|
| `index.html` | Page markup, HUD, and start/pause/game-over overlay |
| `style.css`  | Dark arcade styling shared in spirit with the other games |
| `game.js`    | All game logic and canvas rendering |
| `tests/qbert.spec.js` | Playwright test suite |
| `design.md`  | How the code is structured and the design decisions made |

## Running the tests

From the repository root:

```powershell
npx playwright test Qbert/tests/
```

## Status

**Complete** — all Playwright tests pass and the game is playable and polished.
