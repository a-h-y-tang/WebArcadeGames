# Praise Echo

*"Praise him with the sounding of the trumpet, praise him with the harp and
lyre, praise him with timbrel and dancing."* — Psalm 150:3-4

A musical memory game. Four instruments of praise — trumpet, strings, drum and
bells — play a growing melody across four coloured pads; listen and watch, then
echo it back. Every round adds one more note, so the melody gets longer until
your memory finally slips. Your score is the longest melody you echo correctly.

## How to play

1. Open `index.html` in any modern browser (no build step, no server).
2. Press **Space** / **Enter** (or click **Start Game**) to begin.
3. Watch the pads flash, then reproduce the sequence in the same order.

### Controls

| Action           | Input                                  |
|------------------|----------------------------------------|
| Activate a pad   | Click / tap it, or press **1–4**       |
| Pad 1 · green    | top-left · key **1**                   |
| Pad 2 · red      | top-right · key **2**                  |
| Pad 3 · yellow   | bottom-left · key **3**                |
| Pad 4 · blue     | bottom-right · key **4**               |
| Start / restart  | **Space** / **Enter** or the button    |

## Rules

- Each round the whole pattern replays from the beginning, then it's your turn.
- Reproduce the full pattern to score the round and advance; the game adds one
  more step and plays again.
- A single wrong pad ends the game (strict mode).
- Your best score is saved locally between sessions.

## Development

Tests are written with [Playwright](https://playwright.dev) and live in
`tests/`. From the repository root:

```powershell
npm install
npx playwright install chromium
npx playwright test PraiseEcho/tests/
```

See [design.md](design.md) for how the code is structured and the design
decisions behind it.
