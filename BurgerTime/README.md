# BurgerTime

Chef Peter Pepper is loose in a kitchen made of platforms and ladders. Four
burgers hang in pieces across six floors — walk over every segment of an
ingredient and it drops a floor. Get all four pieces of a stack onto the plate
at the bottom to serve the burger, and clear all four to finish the level.

You are not alone: hot dogs, pickles and eggs climb the ladders after you. A
shake of pepper freezes one for a few seconds, but the real weapon is gravity —
a monster standing on an ingredient when it drops rides it down and is flattened
for a fat score bonus.

## Playing

Open `index.html` in any browser. No build step, no server.

| Input | Action |
|---|---|
| `←` `→` | Walk along a floor |
| `↑` `↓` | Climb a ladder (only where one is lined up) |
| `Space` | Throw pepper |
| `Enter` | Start a run |
| `P` | Pause / resume |

## How it works

- **Walking a piece down.** Each ingredient is four segments wide. Every segment
  the chef treads sinks; once all four are down the piece falls to the floor
  below and its segments pop back up, so it has to be re-walked on every floor.
- **Chain drops.** A piece landing on another knocks that one loose too, and
  they keep falling together. Longer chains cover more ground for free.
- **Riding.** Stand on an ingredient as it drops and you ride it down — the
  fastest way off a floor, and the only way to travel while pepper-less.
- **Squashing.** Monsters caught by a falling ingredient are flattened. Points
  escalate with each monster in a single drop: 500, 1000, 2000, 4000.
- **Pepper.** Five shakes per life. A frozen monster is harmless and can be
  walked straight through.
- **Levels.** Clearing all four burgers awards a bonus and starts a faster
  level. Losing all three chefs ends the run; the best score is remembered in
  the browser.

## Ladders

Ladders at the four burger centres run the full height of the kitchen. The three
ladders in the gaps between burgers stop one floor short of the top — the top
floor is only reachable by climbing through a burger.

## Design notes

See [DESIGN.md](DESIGN.md) for the geometry, the simulation model and the
assumptions behind this version.

## Tests

```powershell
npx playwright test BurgerTime/tests/
```

70 Playwright specs cover movement and ladder rules, segment treading, chain
drops and plating, riding, squash scoring, pepper, monster pathing, lives and
level flow — plus a full playthrough that walks all sixteen pieces onto the
plates with real input and asserts the level clears with the burgers stacked the
right way up.
