# BurgerTime

Chef Peter Pepper is trapped in a giant kitchen. Four burgers hang in pieces on
a lattice of girders and ladders, and the only way to finish them is to walk
each ingredient down, one floor at a time, onto the plates at the bottom — while
hot dogs, eggs and pickles chase you around the scaffolding.

Open `index.html` in a browser. No build step, no server.

![BurgerTime](screenshot.png)

## How to play

Walk across **every slice** of an ingredient and it drops one floor. Ingredients
land on the girder below and have to be walked again — unless they land on
another ingredient, in which case both cascade downward together. Get all four
pieces of a burger onto its plate to bank the bonus; clear all four burgers to
move to the next level.

The food is out to get you. Touch an enemy and you lose a chef. You have two
ways to fight back:

- **Drop an ingredient on one.** A falling ingredient squashes anything it
  touches on the way down. Line them up.
- **Throw pepper.** A limited supply, refilled every level. The cloud lands just
  in front of you and freezes anything caught in it for a few seconds — long
  enough to run past, or to set up a drop.

## Controls

| Input | Action |
|---|---|
| `←` `→` or `A` `D` | Run along a girder |
| `↑` `↓` or `W` `S` | Climb a ladder (line up with it first) |
| `Space` | Throw pepper — also starts and restarts the game |
| `P` | Pause / resume |

Ladders only catch you when you are lined up with one, so hold the direction you
are running plus `↑` or `↓` and you will grab the ladder as you reach it.

## Scoring

| Event | Points |
|---|---|
| Ingredient dropped one floor | 50 |
| Enemy squashed by an ingredient | 100 × level |
| Burger completed | 500 |
| Level cleared | 1000 |

A cascade scores for every ingredient it knocks loose, so setting up a stack
before you drop the top one is worth far more than dropping pieces one by one.
Your best score is kept in the browser's local storage.

## Difficulty

Each level keeps the same kitchen but the enemies get faster and spawn more
often (up to five at a time). Enemy speed is capped below the chef's, so you can
always outrun them in a straight line — the danger is being cornered on a girder
with a ladder you cannot reach.

## Under the hood

See [DESIGN.md](DESIGN.md) for the world model, the shared movement rules used
by both the chef and the enemies, the ingredient cascade logic, and the
assumptions made where the design was ambiguous.

## Tests

From the repository root:

```powershell
npx playwright test BurgerTime/tests/
```

64 Playwright specs cover the board geometry, movement and ladder rules,
ingredient stepping/dropping/cascading/plating, enemy chase behaviour, pepper,
lives, level progression, pausing and score persistence.
