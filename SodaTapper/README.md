# Soda Tapper

A four-counter bar-service arcade game, built with plain HTML5 canvas and
JavaScript — no build step, no dependencies. You are the soda jerk working
**four counters at once**. Thirsty customers shuffle in from the far end of each
counter and march toward your tap station; slide full mugs down the counter to
push them back, and be standing in the right lane to catch the empties they send
back at you.

Inspired by the 1983 tavern-service coin-ops.

![Soda Tapper screenshot](screenshot.png)

## How to play

Open `index.html` in any modern browser. Press **Space** (or click **Start
Game**) to begin.

| Key | Action |
|---|---|
| ↑ / W | Move up one counter |
| ↓ / S | Move down one counter |
| Space | Serve a mug (starts / restarts the game when not playing) |
| Mouse move | Jump to the counter under the pointer |
| Click | Serve a mug |
| P | Pause / resume |

- Every mug a customer drinks knocks them back down the counter and scores
  **10 × wave**. Empty them out and they leave for **50 × wave** more.
- Every drink sends an **empty mug** sliding back toward you. Catch it in the
  lane it comes back down for **5 × wave** — miss it and it shatters.
- Clear a wave for **100 × wave** and a bonus life (up to 5).

You lose a life when:

1. a customer reaches your tap station,
2. a full mug runs off the far end of a counter, or
3. an empty mug comes back down a lane you aren't standing in.

You start with 3 lives; when the last one is gone the game ends. Your best score
is saved in the browser's `localStorage`.

Later waves send more customers, faster, with more drinks each and less time
between arrivals — so the empties pile up exactly when you can least afford to
chase them.

## Development

Soda Tapper follows the repo-wide test setup. From the repository root:

```powershell
npm install
npx playwright install chromium
npx playwright test SodaTapper/tests/
```

See [DESIGN.md](DESIGN.md) for how the code is structured and how the simulation
is made deterministic for testing.
