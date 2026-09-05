# Defender

A side-scrolling planetary rescue shooter. Ten humanoids are stranded on a
planet four screens wide, and the landers are coming down to take them.

![Defender](screenshot.png)

## How to play

Open `index.html` in any modern browser — no build step or server needed.
Press **Space** (or click **Start Game**) to launch.

| Input | Action |
|---|---|
| <kbd>←</kbd> <kbd>→</kbd> (or <kbd>A</kbd> <kbd>D</kbd>) | Thrust, and turn the ship around |
| <kbd>↑</kbd> <kbd>↓</kbd> (or <kbd>W</kbd> <kbd>S</kbd>) | Climb and dive |
| <kbd>Space</kbd> | Fire |
| <kbd>B</kbd> | Smart bomb |
| <kbd>P</kbd> / <kbd>Enter</kbd> | Pause / resume |

## The rules

- **Landers** descend on the humanoids standing on the ground. One that reaches
  a humanoid picks it up and starts climbing.
- A carrier that reaches the **top of the screen** mutates into a **mutant** —
  fast, and interested only in ramming you — and that humanoid is gone.
- Shoot a carrier and its humanoid **falls**. Fly into it to catch it (250),
  then skim the mountain tops to set it down again (500).
- Clear every alien to end the wave. Each surviving humanoid pays **100**, the
  next wave brings one more lander, and every third wave restocks a smart bomb.
- Lose all ten humanoids and the **planet dies**: every remaining lander mutates
  at once and the landscape burns red for the rest of the run.
- A smart bomb destroys everything currently on screen. You start with three.
- Touching an alien or an alien shot costs a ship. Three ships, then it's over.

## Reading the scanner

The strip across the top of the canvas is the whole planet, squeezed to a
quarter scale: pink dots are humanoids, green are landers, orange are mutants,
white is you, and the outlined box is the slice you can actually see. Most of
what kills you starts off screen, so fly by the scanner.

## Scoring

| Event | Points |
|---|---|
| Lander destroyed | 150 |
| Mutant destroyed | 250 |
| Falling humanoid caught | 250 |
| Humanoid set back on the ground | 500 |
| Each humanoid alive at the end of a wave | 100 |

Your best score is kept in `localStorage`.

## Development

[DESIGN.md](DESIGN.md) explains how the code is put together and which arcade
features were deliberately left out.

Tests are Playwright specs in `tests/`:

```powershell
npx playwright test Defender/tests/
```
