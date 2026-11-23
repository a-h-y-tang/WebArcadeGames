# Keeper of the Garden

*"The LORD God took the man and put him in the garden of Eden to work it and
keep it."* — Genesis 2:15

An HTML5 canvas arcade game in the tradition of *Centipede*. A long caterpillar
crawls in at the top of the garden and winds its way down through the thistles
toward you. You are the keeper, with a watering can and the bottom of the garden
to walk in: squirt water upward and shoo the caterpillar away one segment at a
time — but every segment you catch in the middle splits the chain into two
shorter, livelier caterpillars.

Open `index.html` in any browser — no build step, no server.

## How to play

| Input | Action |
|---|---|
| `←` `→` `↑` `↓` or `W` `A` `S` `D` | move the keeper around the bottom patch |
| `Space` (hold to keep going) | squirt water upward |
| `P` | pause / resume |
| `Space`, `Enter`, an arrow key or the button | start, and start again after a game over |
| `R` | start over at any time |

You have three lives. Touching a caterpillar, the snail or the bee costs one.

## What is in the garden

- **The caterpillar** — a chain of segments that crawls sideways and drops a row
  whenever it meets the edge of the garden or a thistle. Reach the bottom and it
  turns around and climbs back up. A body segment is worth **10**, the head
  **100**.
- **Thistles** — the obstacle field. They turn the caterpillar and they stop your
  water. Four squirts clear one: **1** point a squirt and **5** more for
  clearing it. A watered caterpillar segment leaves a fresh thistle behind, so
  the garden gets thicker the longer you play.
- **The snail** — wanders through your patch every nine seconds or so, eating any
  thistle it crosses. Worth **300**.
- **The bee** — arrives when the thistles near you have thinned out and plants a
  new row of them on the way down. The first drop of water only hurries it
  along; the second shoos it off for **200**.

Clear every segment and the next wave arrives — longer and faster — with a bonus
of **50 × level**. Your best score is kept in the browser.

## Files

| File | What it is |
|---|---|
| `index.html` | the page: HUD, canvas, overlay, controls and the verse |
| `style.css` | the dark-garden styling |
| `game.js` | the whole game: state, `step(dt)` physics, drawing and input |
| `DESIGN.md` | how the code works, and the assumptions behind the rules |
| `tests/` | the Playwright suite the game was built against |

## Tests

From the repository root:

```powershell
npx playwright test KeeperOfTheGarden/tests/
```

The suite drives the game through its state rather than through screenshots: it
freezes the animation loop with `freezeLoop()` and advances the world by exact
amounts with `step(dt)`, so the turning rule, the splitting rule, the scores and
the creatures are all checked deterministically.
