# Marble Chain

A spiral-track marble shooter. A chain of coloured marbles crawls towards the
pit at the centre of the spiral — fire marbles into it and pop runs of three or
more before one drops in.

![Marble Chain](screenshot.png)

## Playing

Open `index.html` in any browser. No build step, no server.

## How to play

- **Aim** with the mouse (or `←` / `→` for fine adjustment).
- **Fire** with a click or `Space`.
- Land a marble so that **three or more of one colour** sit together and they
  pop.
- Press `X` to swap the loaded marble for the one on deck when you have the
  wrong colour.
- Press `P` to pause.

## Scoring

| Event | Points |
|---|---|
| Marbles popped | 10 each |
| Chain reaction | ×2, ×3, … for each follow-up pop from one shot |
| Level cleared | 100 × level |

A pop can pull two like-coloured groups together, and those pop as well at a
higher multiplier — setting up chain reactions is where the big scores are.

## Rules

- Clear every marble on the track to finish the level.
- Each level adds marbles, speed and eventually a fifth colour.
- If a marble reaches the pit you lose one of your three lives and the level's
  chain restarts. At zero lives the game is over.
- Your best score is kept in the browser's local storage.

## Tests

```powershell
npx playwright test MarbleChain/tests/
```

See [DESIGN.md](DESIGN.md) for how the track, chain physics and matching work.
