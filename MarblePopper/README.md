# Marble Popper

A Zuma-style marble shooter. A chain of coloured marbles crawls along a spiral
track toward the pit at its centre. You sit in the middle with a launcher —
fire marbles into the chain and line up three or more of a colour to blow them
away. Clear the whole chain before its head reaches the pit.

Open `index.html` in a browser — no build step, no server.

## How to play

- Aim with the mouse (or the arrow keys) and click / press <kbd>Space</kbd> to fire.
- A shot wedges itself into the chain wherever it lands. Three or more touching
  marbles of the same colour pop.
- Popping opens a gap; the tail rushes forward to close it. If the two ends that
  meet share a colour and make a run of three, they pop too — combos are worth
  double, triple and so on.
- Swap the loaded marble with the one on deck (<kbd>S</kbd> or right-click) when
  the wrong colour is chambered.
- Clear every marble to finish the level and bank a `100 × level` bonus. Each
  level is longer, faster and eventually uses more colours.
- One marble reaching the pit ends the run. Your best score is remembered in the
  browser.

## Controls

| Input                          | Action                      |
| ------------------------------ | --------------------------- |
| Mouse move                     | Aim the launcher            |
| Click / <kbd>Space</kbd>       | Fire (also starts a run)    |
| <kbd>←</kbd> / <kbd>→</kbd>    | Rotate the aim              |
| <kbd>S</kbd> / right-click     | Swap loaded and next marble |
| <kbd>P</kbd>                   | Pause / resume              |

## Scoring

| Event                | Points                       |
| -------------------- | ---------------------------- |
| Popping marbles      | `10 × marbles × combo`       |
| Clearing a level     | `100 × level`                |

## Development

Implementation notes live in [DESIGN.md](DESIGN.md). Tests are Playwright specs
in `tests/`:

```powershell
npx playwright test MarblePopper/tests/
```
