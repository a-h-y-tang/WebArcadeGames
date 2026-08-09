# Ski Slalom

A downhill slalom racer on an HTML5 canvas. Carve through the gates, dodge the
pines, and beat par time — then do it again on a narrower, busier hill.

![Ski Slalom](screenshot.png)

## Playing

Open `index.html` in a browser. No build step, no server.

## Controls

| Input | Action |
|---|---|
| <kbd>←</kbd> <kbd>→</kbd> (or <kbd>A</kbd>/<kbd>D</kbd>) | carve left / right |
| <kbd>↓</kbd> (or <kbd>S</kbd>) | tuck for extra speed |
| Mouse | steer toward the pointer; hold a button to tuck |
| <kbd>Space</kbd> | start / restart |
| <kbd>P</kbd> | pause |

## How it works

Each **run** is a course of 12 slalom gates ending at a finish banner.

- **Pass a gate** (ski between the two poles) to score. The gate turns green.
- **Miss a gate** and it is crossed out, and 2 seconds go on your clock.
- **Hit a tree** and you go down: you lose a life and 1.1 seconds sprawled in
  the snow. Three crashes and the day is over.
- **Cross the finish line** for a 500 point bonus, a time bonus of 25 points per
  second saved against par (~14.1s), and 300 more for a clean run with no gates
  missed. You also get a life back, up to five.

Every run after the first has narrower gates and more trees. Score carries over
between runs; your best is saved in the browser.

Tucking raises your top speed from 300 to 430, but carving a turn costs speed —
so the fast line is the one that needs the fewest corrections.

## Development

Tests are Playwright specs in `tests/`, run from the repo root:

```powershell
npx playwright test SkiSlalom/tests/
```

See [DESIGN.md](DESIGN.md) for how the code is put together.
