# Tapper

A frantic serving game inspired by the 1983 arcade classic *Root Beer Tapper*.
You're the bartender working **four bars at once**. Thirsty patrons stream in
from the left and march toward the counter — slide a mug of root beer down the
right lane to serve them before they reach you.

## How to play

- Move the bartender **up and down** between the four lanes.
- **Pour** a mug down your current lane; when it catches a patron, that patron is
  served and leaves — you score points (worth more on later waves).
- Let a patron reach the counter without a drink and you **lose a life**.
- Serve every patron in a wave to advance: the next crowd is faster and arrives
  more often.
- Lose all three lives and it's last call. Your best score is saved locally.

You can only pour into the lane you're standing in, so the game is all about
darting between bars and timing each pour.

## Controls

| Input | Action |
|---|---|
| ↑ / ↓ or W / S | Move between lanes |
| Space / Enter / click | Pour a mug (also starts the game) |
| P | Pause / resume |

## Running

Open `index.html` directly in any modern browser — no build step or server
required.

## Tests

Playwright tests live in `tests/`. From the repo root:

```powershell
npx playwright test Tapper/tests/
```

See [DESIGN.md](DESIGN.md) for the game concept, mechanics, and how the code is
structured.
