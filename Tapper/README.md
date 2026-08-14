# Tapper

You are the barkeep. Four bars, one of you, and a saloon full of people who
will not take "closing time" for an answer.

Patrons push in from the far left of each bar and shuffle towards you. Slide a
full mug down the bar to knock one back — but every mug you pour comes back
empty, and an empty mug that reaches the end of a bar with nobody there to
catch it hits the floor.

## How to play

| Input | Action |
|---|---|
| `↑` / `W` | Move up one bar |
| `↓` / `S` | Move down one bar |
| `Space` | Pour a mug down the current bar |
| `P` | Pause / resume |
| Click a bar | Move there — click again to pour |

Open `index.html` in any browser. Nothing to install, nothing to build.

## Rules

- A patron that catches a mug is shoved back down the bar and stops for a
  drink. From level 3 the tougher patrons need two mugs, and from level 5,
  three — the pips floating above a patron show how many they still want.
- A patron that has had enough turns around, walks out, and **scores 100** —
  and slides their empty mug back towards you.
- Catch an empty mug by standing in its lane: **50 points**.
- You lose a life if a patron reaches your end of a bar, if a mug you poured
  runs off the far end and smashes, or if an empty mug comes back to an
  unattended bar.
- Losing a life restarts the current wave. Three lives and it's last orders.
- Clear every patron in a wave for a **200 × level** bonus.

Each level brings more patrons, faster patrons, and thirstier patrons. Your
best score is kept in the browser.

## Files

| File | What it holds |
|---|---|
| `index.html` | Canvas, HUD and overlay markup |
| `style.css` | Saloon colour scheme and layout |
| `game.js` | All game state, simulation and rendering |
| `DESIGN.md` | How the code is put together, and the rules in detail |
| `tests/tapper.spec.js` | Playwright suite (76 tests) |

## Tests

From the repository root:

```powershell
npx playwright test Tapper/tests/
```
