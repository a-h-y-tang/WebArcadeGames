# Gleaning Fields

*"Let her glean even among the sheaves, and don't reprimand her."* — Ruth 2:15

A maze-chase game on an HTML5 canvas. Help Ruth gather every grain of barley in
Boaz's field while the little foxes chase her through the hedgerows — and pick
up an oil lamp to send the foxes running.

## How to play

Open `index.html` in any modern browser — no build step or server required.

### Controls

| Action          | Keys                        |
|-----------------|-----------------------------|
| Move            | `←` `↑` `→` `↓` or `W A S D` |
| Pause / resume  | `P`                         |
| Start / restart | `Space` or any arrow key    |

### Rules

- Gather all the grain to clear the field and advance to the next (faster) level.
- Each grain scores 10 points; the four flickering **oil lamps** score 50 and
  briefly **frighten** the foxes — while frightened they turn grey and flee, and
  you can catch them for 200 points each. A caught fox becomes a pair of eyes
  that scurries back to its den and returns.
- Touching a fox that isn't frightened costs a life. You start with 3; lose them all and it's
  game over.
- Your best score is saved in the browser via `localStorage`.

## Development

Tests are written with [Playwright](https://playwright.dev). From the repo root:

```powershell
npx playwright test GleaningFields/tests/
```

See [DESIGN.md](DESIGN.md) for how the code is structured.
