# Lode Runner

Collect every piece of gold, dig your way out of trouble, and climb off the top
of the screen before the guards catch you.

![Lode Runner](screenshot.png)

## Playing

Open `index.html` in a browser — no build step or server required.

## How to play

Run along the girders, climb the ladders and swing along the ropes to grab all
the gold. You cannot jump and you cannot fight. What you can do is burn a hole
in the brick beside your feet: a guard that falls in is stuck for a couple of
seconds, and if the brick heals over while they are still in it they are crushed
and sent back to their post.

Holes reseal after five seconds — the last stretch flashes as a warning — and
they will crush you just as happily as a guard, so do not linger in one.

Once the last coin is gone, a hidden escape ladder appears at the edge of the
level. Climb it off the top of the screen to move on.

## Controls

| Key | Action |
|---|---|
| `←` `→` or `A` `D` | run, and travel along a rope |
| `↑` `↓` or `W` `S` | climb a ladder; `↓` also drops you off a rope |
| `Z` or `,` | dig down-left |
| `X` or `.` | dig down-right |
| `P` | pause / resume |
| `Space` | start, and continue to the next level |

## Scoring

| Event | Points |
|---|---|
| Gold collected | 150 |
| Guard crushed | 75 |
| Level cleared | 500 |

Three lives. Losing one puts every runner back on their spawn and reseals any
open holes, but the gold you have already banked stays banked. Your best score
is remembered in the browser.

## Levels

Three levels, each a 28 x 16 grid. The third hides a coin in a sealed pocket
that can only be reached by digging through the floor above it.

## Tests

From the repository root:

```powershell
npx playwright test LodeRunner/tests/
```

See [DESIGN.md](DESIGN.md) for how the code and the level format work.
