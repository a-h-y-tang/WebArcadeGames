# Sparrow's Garden

*"Are not two sparrows sold for a penny? Yet not one of them will fall to the
ground outside your Father's care."* — Matthew 10:29

A maze game on an HTML5 canvas. A sparrow hops the gravel paths of a walled
kitchen garden, pecking up every seed scattered along them, while four garden
cats prowl the same paths. Peck a sunflower head and the cats turn shy for a
few seconds — reach one then and it scampers home to the shed.

Nobody is hurt in this garden: a cat that catches the sparrow only startles it
home, and a shy cat the sparrow reaches simply runs back to the shed.

## How to play

Open `index.html` directly in a browser — no build step or server needed.

### Controls

| Input | Action |
|---|---|
| Arrow keys / **W A S D** | Hop up, left, down, right |
| **P** or the Pause button | Pause / resume |
| Any direction key, **Space**, **Enter** or **Start** | Begin play |
| Restart button | Start a new game |

Turn early — the sparrow takes a queued turn at the first corner that allows
it, and carries straight on until then.

### Scoring

| | Points |
|---|---|
| Seed | 10 |
| Sunflower head | 50 |
| Berry | 100 |
| Shooing a shy cat | 200, then 400, 800, 1600 in one sunflower |

Peck all 204 seeds and sunflowers to clear the garden and a fresh one is laid
out, with quicker cats and a shorter spell of shyness. A berry ripens in the
middle of the garden once sixty seeds have gone and stays for eight seconds.

You have three lives. Your best score is saved in your browser.

### The cats

| Cat | How it hunts |
|---|---|
| **Tabby** | straight for the sparrow |
| **Ginger** | four cells ahead of where the sparrow is going |
| **Smoke** | cuts across, aiming through Tabby at the path ahead |
| **Snowy** | chases only inside eight cells, then wanders back to her corner |

All four head for their own corners for the first few seconds of each garden,
and again for a spell part-way through — a breather worth waiting for.

## Development

Tests live in `tests/` and run with the repository's Playwright setup:

```powershell
npx playwright test SparrowsGarden/tests/
```

`DESIGN.md` explains how the code is put together.
