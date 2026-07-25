# Dots and Boxes

The classic pencil-and-paper strategy game, built with HTML5 Canvas — you
(Blue) against a computer opponent (Red) on a 4×4 grid of boxes.

## How to Play

Open `index.html` in any modern browser — no build step, no dependencies.

| Input | Action |
|---|---|
| Move the mouse near a line | Preview the line you would draw |
| Click | Draw the nearest line |
| New Game button | Start a fresh game |

**Objective:** Take turns drawing a single horizontal or vertical line between
two adjacent dots. When you draw the **fourth side of a box**, you claim it —
and you get to **go again**. When all 16 boxes are claimed, whoever owns the
most boxes wins.

**Strategy:** Avoid drawing the third side of a box — that hands your opponent
a free box on their next turn. Late in the game, giving away a small chain to
grab a bigger one (the "double-cross") is often the winning play.

You are **Blue** and move first. The computer plays a deterministic
greedy-but-safe strategy: it always takes a box when it can, otherwise plays a
line that doesn't give one away.

## Development

Tests are written with Playwright and live in `tests/`.

```powershell
npx playwright test DotsAndBoxes/tests/
```

See [DESIGN.md](DESIGN.md) for how the code works.
