# Kaboom!

A single-screen reflex arcade game. A "Mad Bomber" paces along the top of the
screen dropping bombs; you slide a stack of buckets along the bottom to catch
every one before it hits the ground.

## How to play

1. Open `index.html` in a browser — no build step or server needed.
2. Click **Start Game** (or press **Space**).
3. Move the bucket stack to catch each falling bomb:
   - **← / →** or **A / D** to slide
   - **Mouse move** over the play field to aim
4. Catch every bomb in a wave to advance to the next, faster wave.
5. Miss a bomb and you lose a bucket and the screen clears. Lose all three
   buckets and it's game over.

## Scoring

- Each caught bomb is worth `wave` points (later waves are worth more).
- Each wave is `10` bombs; clearing one without a miss speeds up the bomber and
  the bombs.
- Your best score is saved in the browser (`localStorage`).

## Development

Tests are written with Playwright and live in `tests/`.

```powershell
npx playwright test Kaboom/tests/
```

See [DESIGN.md](DESIGN.md) for the concept, mechanics, and the testable core the
Playwright suite drives.
