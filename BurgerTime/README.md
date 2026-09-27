# BurgerTime

A ladder-and-girder arcade game on an HTML5 canvas. You are a short-order chef
loose in a giant kitchen. Three burgers hang in pieces on a lattice of floors and
ladders — walk the full width of an ingredient and it drops to the floor below,
knocking whatever it lands on loose in turn. Assemble all three burgers on the
plates at the bottom to clear the level, while four food-monsters hunt you across
the girders.

![BurgerTime](screenshot.png)

## Playing

Open `index.html` in any modern browser. No build step and no server required.

## Controls

| Input | Action |
|---|---|
| `←` `→` / `A` `D` | walk along a floor |
| `↑` `↓` / `W` `S` | climb a ladder |
| `Space` | spray pepper (also starts the game when idle or after game over) |
| `Enter` | start / restart |
| `P` | pause / resume |

## How to play

**Drop the burgers.** Each ingredient is four tiles wide. Walking over a tile
presses it down; press all four and the ingredient falls to the floor below. If it
lands on another ingredient, that one is knocked loose too and the whole stack
cascades toward the plate — a full four-piece cascade is worth far more than four
separate drops. Plate all twelve ingredients (three burgers × four pieces) to
clear the level.

**Ride it down.** You are standing on the ingredient when its last tile gives way,
so you ride it down — through every link of a cascade — and you cannot be caught
while riding. It is the game's escape hatch: get cornered, and dropping a piece is
often the only way out.

**Mind the ladders.** The two edge ladders run the full height of the kitchen; the
middle ones are half-height and offset, so crossing the board vertically forces
you to walk along a floor between climbs. That is where the monsters get you.

**The monsters.** Mr. Hot Dog, Mr. Pickle, Mr. Egg and Mr. Sausage walk the same
girders and ladders you do and head straight for you, climbing when they need to.
Touching one costs a life; you have three. They get faster and arrive more often
each level, and from level 3 they also come in from the top corners.

**Pepper and squashing.** `Space` sprays pepper one step ahead of you, stunning
anything it catches for four seconds — stunned monsters are harmless and you can
walk straight past them. Five shakes per level, and they refill when you clear
one. Better still, drop an ingredient on a monster: it squashes flat for 500
points × the cascade multiplier.

## Scoring

| Event | Points |
|---|---|
| Ingredient dropped | 50 × cascade length |
| Monster squashed | 500 × cascade length |

Your best score is remembered in `localStorage`.

## Development

`DESIGN.md` explains the layout maths, the movement model, the cascade rules and
the monster AI, and records the assumptions made while building it.

Tests are Playwright specs in `tests/`:

```powershell
npx playwright test BurgerTime/tests/
```

All game motion is expressed per-second and advanced through `step(dt)`, so the
specs simulate frames deterministically rather than waiting on wall-clock time.
