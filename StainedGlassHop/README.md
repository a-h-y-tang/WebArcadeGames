# Stained Glass Hop

*"You are the light of the world. A town built on a hill cannot be hidden."*
— Matthew 5:14

An HTML5 Canvas pyramid-hopping game. Hop a little chorister around a pyramid of
28 stained-glass panes, lighting each one up in jewel colours to finish the
window — while dodging the edges and the stones rolling down toward you.

## How to Play

Open `index.html` in any modern browser — no build step, no dependencies.

The chorister hops **diagonally**, so each arrow key moves you toward one corner of the
cube you're standing on (the classic 45°-rotated joystick):

| Input            | Hop        |
|------------------|------------|
| Arrow Up / W     | up-right   |
| Arrow Right / D  | down-right |
| Arrow Down / S   | down-left  |
| Arrow Left / A   | up-left    |
| P                | pause / resume |

**Objective:** light all 28 panes of glass by landing on them. Each freshly lit
pane scores **25** points. Colour them all to complete the level and move on to a
faster one.

**Watch out:**

- **The edges.** Hop off the side of the window and you fall — that costs one of
  your **3 lives**. You respawn on the top cube; the panes you've already lit
  stay lit.
- **Rolling stones.** They appear near the top and bounce downward. Share a cube with
  one — by hopping into it or letting it land on you — and you lose a life.

Lose all three lives and it's game over. Your best score is saved between plays.

## Files

| File | Purpose |
|------|---------|
| `index.html` | Page markup, HUD, and start/pause/game-over overlay |
| `style.css`  | Dark arcade styling shared in spirit with the other games |
| `game.js`    | All game logic and canvas rendering |
| `tests/stained-glass-hop.spec.js` | Playwright test suite |
| `design.md`  | How the code is structured and the design decisions made |

## Running the tests

From the repository root:

```powershell
npx playwright test StainedGlassHop/tests/
```

## Status

**Complete** — all Playwright tests pass and the game is playable and polished.
