# Burger Time

A platform-and-ladder arcade game. You are a chef on a scaffold of girders
above four dinner plates, and the burgers have been scattered up the levels.
Walk across every piece of a layer to make it collapse onto the girder below,
keep walking it down, and land it on the plate. Build all four burgers to clear
the level — while the food chases you.

Open `index.html` in a browser. No build step, no server.

## How to play

Each of the four columns holds a five-layer burger: bun top, lettuce, patty,
cheese, bun bottom, spread over the five upper girders with an empty plate at
the bottom.

Every layer is split into four pieces. Walking over a piece makes it sag; once
all four have sagged, the layer drops to the girder below. It has to be walked
again from there — and again — until it reaches the plate.

Drop a layer onto one that is already resting below and both keep falling, so a
well-timed drop can send a whole column down in one cascade.

Hot dogs, fried eggs and pickles patrol the scaffold and climb the ladders
after you. Touching one costs a chef. You start with three.

### Pepper

You carry five shakes of pepper per level. `Space` throws a cloud just in front
of you that freezes any enemy it touches for about four seconds. Frozen enemies
can't hurt you — and they can still be squashed by a falling layer.

### Scoring

| Event | Points |
|---|---|
| Dropping a layer | 50 |
| Squashing an enemy with a falling layer | 500, doubling up the chain: 500 / 1000 / 1500 … |
| Clearing a level | 1000 + 100 × level |

Your best score is kept in the browser's local storage.

## Controls

| Input | Action |
|---|---|
| `←` `→` or `A` `D` | Walk |
| `↑` `↓` or `W` `S` | Climb a ladder |
| `Space` | Throw pepper (also starts the game) |
| `P` | Pause / resume |
| `R` | Restart |

## Tips

- Stand on a ladder to line yourself up — enemies have to come to you along the
  girder, and the ladder is your escape in both directions.
- Save your pepper for the moment two enemies converge; one cloud can freeze
  both.
- The biggest scores come from luring enemies into a column and then dropping a
  layer through it — the chain bonus stacks fast.

## Development

Tests live in `tests/` and run with the repo-wide Playwright setup:

```powershell
npx playwright test BurgerTime/tests/
```

See [DESIGN.md](DESIGN.md) for how the code is put together.
