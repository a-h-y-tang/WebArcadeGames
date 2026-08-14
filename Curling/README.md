# Curling

A sheet of curling ice on an HTML5 canvas. Draw, guard and take out against a
computer skip over four ends.

![Curling](screenshot.png)

## Playing

Open `index.html` in a browser. No build step or server required.

## How to play

You throw from the hack on the right; the house is on the left. Each delivery
takes three decisions:

- **Aim** — <kbd>↑</kbd> <kbd>↓</kbd> tilt the line up or down the sheet.
- **Weight** — <kbd>←</kbd> <kbd>→</kbd> set how far the stone will run. Around
  59 is a draw to the button; over 80 is takeout weight, which runs out the back
  of the house if it misses.
- **Handle** — <kbd>H</kbd> flips between an in-turn (curls down the sheet) and
  an out-turn (curls up it). The curl arrives late, as the stone slows, so you
  can bend a draw around a guard.

Press <kbd>Space</kbd> to deliver, then **keep holding it to sweep**: a swept
stone runs about a quarter farther and curls much less. The dotted line shows
where the stone would finish unswept.

A stone that stops short of the red hog line is taken off. So is one that runs
past the back line or touches a side line — which is how takeouts work.

## Scoring

When both teams have thrown their six stones the end is scored: the team with
the stone closest to the button gets a point for it, plus a point for every
other stone it has closer than the other team's nearest. Only stones touching
the rings count, so an end where the house is empty is a blank.

The team that gets scored on throws last — the hammer — in the next end. Highest
total after four ends wins.

## Controls

| Input | Action |
|---|---|
| <kbd>↑</kbd> <kbd>↓</kbd> / <kbd>W</kbd> <kbd>S</kbd> | Aim |
| <kbd>←</kbd> <kbd>→</kbd> / <kbd>A</kbd> <kbd>D</kbd> | Weight |
| <kbd>H</kbd> | Handle (in-turn / out-turn) |
| <kbd>Space</kbd> | Deliver, then hold to sweep |
| <kbd>P</kbd> | Pause |
| Mouse | Aim at a spot and click to deliver |

Your best match total is kept in `localStorage`.

## Tests

```powershell
npx playwright test Curling/tests/
```

See [DESIGN.md](DESIGN.md) for how the physics, scoring and computer skip work.
