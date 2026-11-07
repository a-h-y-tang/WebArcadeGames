# Jordan Crossing

*"He makes me lie down in green pastures, he leads me beside quiet waters."*
— Psalm 23:2

A road-and-river crossing game built with HTML5 Canvas. Help a little lamb hop
across a busy caravan road and the log-strewn River Jordan to reach the safety of
the sheepfolds, without getting knocked over or swept away.

## How to Play

Open `index.html` in any modern browser — no build step, no dependencies.

| Input | Action |
|---|---|
| Arrow keys or WASD | Hop one cell |
| P | Pause / resume |
| Any arrow / WASD | Start or restart |

**Objective:** Guide the lamb from the bottom start row up to one of the five
empty **sheepfolds** at the top.

- **Caravan road (lower half):** dodge the camels, donkeys and carts — getting
  knocked over costs a life.
- **River Jordan (upper half):** the water is too deep, so ride the floating
  **logs** across. A log will carry your lamb along; ride it off the screen edge
  and you are swept away.
- **Home:** land squarely in an empty sheepfold to score. Miss the folds and
  you lose a life. Fill all five folds to clear the level — the folds reset and
  every lane gets faster.

**Scoring:** +10 for each new row you reach on a trip, +50 for landing in a fold,
and a +100 bonus for completing a full set of folds.

**Lives:** You start with 3. Your best score is saved in `localStorage` and
persists between sessions.

## Development

Tests live in `tests/jordan-crossing.spec.js` and run with the repo-wide Playwright
setup:

```powershell
npx playwright test JordanCrossing/tests/
```

See [design.md](design.md) for how the code is structured.
