# Lode Runner

A dig-and-collect platformer on an HTML5 canvas. Gather every piece of gold in
the vault while guards hunt you across girders, ladders and ropes — then climb
the exit ladder that appears when the last nugget is yours.

![Lode Runner](screenshot.png)

## Playing

Open `index.html` in any modern browser. No build step and no server needed.

## Controls

| Key | Action |
|---|---|
| `←` `→` or `A` `D` | run, or swing hand-over-hand along a rope |
| `↑` `↓` or `W` `S` | climb a ladder; `↓` also lets go of a rope |
| `Z` or `,` | dig the brick down and to your left |
| `X` or `.` | dig the brick down and to your right |
| `R` | give up on the level (costs a life) |
| `P` | pause / resume |
| `Space` or `Enter` | start, or play again after game over |

## How it plays

You cannot jump and you cannot fight. Your only weapon is the shovel: dig a
hole in the brick floor beside you and whatever falls in is stuck there.

- **Gold** is collected by touching it. Collect every piece and the level's
  hidden **exit ladder** lights up; climb it to the top of the screen to move
  on. Three levels; clear the last one to win the run.
- **Guards** chase you along any route they can find. Touching one costs a
  life. A guard that falls into a hole is helpless — walk right over its head.
- **Holes grow back.** A dug brick flashes shortly before it closes. A guard
  caught inside is buried (and comes back somewhere else); if *you* are inside,
  you lose a life.
- **Guards steal gold.** A guard that walks over a nugget pockets it, and the
  exit will not open while it is carrying one. Trap the guard and it drops the
  gold at your feet.
- **Stone** (the grey blocks) cannot be dug. Bricks can.

Watch the drop: falling is safe from any height, but you can only dig while
standing on solid ground, so plan your route down before you take it.

## Scoring

| Event | Points |
|---|---|
| Gold collected | 250 |
| Guard trapped in a hole | 75 |
| Guard buried by a refilling brick | 150 |
| Level completed | 1500 |

Your best score is stored in the browser under `loderunner-best`.

## Development

`design.md`-style notes on how the code works live in [DESIGN.md](DESIGN.md).
The Playwright suite lives in `tests/` and runs from the repository root:

```powershell
npx playwright test LodeRunner/tests/
```
