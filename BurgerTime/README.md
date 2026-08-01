# Burger Time

A single-screen platform arcade game built with plain HTML5 canvas and
JavaScript — no build step, no dependencies. You are a chef on a lattice of
platforms and ladders with four giant burgers hanging in pieces above four
plates. Walk the full width of an ingredient and it drops a floor; keep walking
the pieces down until every burger is assembled on its plate.

The food fights back. Hot dogs, eggs and pickles climb the same ladders you do
and one touch costs a life — so use your pepper, or drop an ingredient on their
heads.

Inspired by the 1982 Data East classic.

![Burger Time screenshot](screenshot.png)

## How to play

Open `index.html` in any modern browser. Press **Space** (or click **Start
Game**) to begin.

| Key | Action |
|---|---|
| ← / A | Walk left |
| → / D | Walk right |
| ↑ / W | Climb up (only while standing on a ladder) |
| ↓ / S | Climb down |
| Space | Throw pepper — also starts the game from the title screen |
| Enter | Start / restart |
| P | Pause / resume |

### Dropping ingredients

Every ingredient is four segments wide. Stepping on a segment makes it sag;
once all four segments have been stepped, the ingredient breaks loose and falls.

- Landing on an **empty floor** parks it there — walk it again to send it lower.
- Landing on an **occupied floor** knocks the resident ingredient down a level
  too, which can start a chain down the column.
- Landing on the **plate** takes it out of play. Four pieces on a plate is a
  finished burger.

### Staying alive

- Touching an enemy costs one of your three lives. Everyone returns to their
  starting position, but the burgers stay exactly where you left them.
- **Pepper** freezes every enemy in the cloud for four seconds. You get five
  shakes per level, refilled when the level is cleared.
- A **falling ingredient flattens** any enemy under it. Catch several with one
  drop and the points double each time: 500, 1000, 2000…
- Flattened enemies come back after five seconds, so the board never stays clear.

### Scoring

| Event | Points |
|---|---|
| Dropping an ingredient | 50 |
| Knocking another ingredient loose | 50 |
| Squashing an enemy | 500, doubling per enemy in the same drop |
| Completing a burger | 1000 |
| Clearing a level | 1000 × level |

Clearing all sixteen ingredients rebuilds the burgers, refills your pepper and
speeds the enemies up. A fourth enemy joins on level 3 and a fifth on level 5.
Your best score is kept in the browser via `localStorage`.

## Files

| File | Purpose |
|---|---|
| `index.html` | HUD, canvas and overlay markup |
| `style.css` | Diner-sign presentation |
| `game.js` | Board geometry, simulation (`tick`), rendering (`draw`), input |
| `DESIGN.md` | How the code works and the assumptions behind it |
| `tests/burgertime.spec.js` | Playwright suite (66 tests) |

## Tests

From the repository root:

```powershell
npx playwright test BurgerTime/tests/
```

The suite drives the simulation directly rather than racing the animation
frame: `setAutoLoop(false)` stops the render loop from advancing the clock, and
the test then calls `tick(dt)` with exact time steps.
