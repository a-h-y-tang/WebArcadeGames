# Soda Tapper

A lane-based serving game, built with plain HTML5 canvas and JavaScript — no
build step, no dependencies. Four bars, one server, and a steady stream of
thirsty customers. Slide mugs of soda down the bars to knock customers back
before they reach the tap, then be standing in the right lane to catch the
empties they send sliding back.

Inspired by the classic bartender arcade cabinets.

![Soda Tapper screenshot](screenshot.png)

## How to play

Open `index.html` in any modern browser. Press **Space** (or click **Start
Game**) to begin.

| Key | Action |
|---|---|
| ↑ / W | Move up one bar |
| ↓ / S | Move down one bar |
| Space | Pour a soda (also starts / resumes) |
| Mouse move | Move the server to the bar under the pointer |
| Mouse click | Pour a soda |
| P | Pause / resume |

- A poured mug slides away from the tap. When it reaches a customer they take
  it (**25 points**) and get knocked back down the bar while they drink.
- Knock a customer off the far end of the bar and they leave happy (**100
  points**) — and send an **empty mug** sliding back toward you.
- Catch an empty by standing in its lane as it arrives (**50 points**). Every
  caught empty returns a mug to your tray.
- Your tray holds **4 mugs**. Pouring spends one, catching an empty returns
  one — so pour faster than you can catch and you'll run dry.
- You lose a life if a mug smashes against the far end of a bar, if an empty
  reaches the tap while you're on another bar, or if a customer reaches the
  tap. Losing a life clears every bar and refills the tray.
- Serve everyone in the level to advance: later levels send more customers and
  they walk faster. Clearing a level is worth a bonus of **200 × level**.
- You start with 3 lives. Your best score is saved in the browser's
  `localStorage`.

## Development

Soda Tapper follows the repo-wide test setup. From the repository root:

```powershell
npm install
npx playwright install chromium
npx playwright test SodaTapper/tests/
```

See [DESIGN.md](DESIGN.md) for how the code is structured and how the
simulation is made deterministic for testing.
