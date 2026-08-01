# Burger Time

A platform-and-ladder arcade game on an HTML5 canvas. You are the chef: walk the
girders, climb the ladders, and tread every slice of each ingredient so it falls
onto the plate below — while the hot dogs, eggs and pickles chase you around the
maze.

Open `index.html` in a browser. No build step, no server.

## How to play

Four burgers hang across the level, split into layers on four girder rows. Walk
the **full width** of an ingredient and it drops one floor. An ingredient landing
on another shoves that one down too, so a well-placed walk can cascade a whole
stack onto its plate in one go. Land all four layers of all four burgers to clear
the level.

Enemies hunt you. Touching one costs a life, and you have three. You also carry
five shots of pepper per level: a spray in front of you freezes any enemy caught
in it for a few seconds, long enough to slip past. A falling ingredient squashes
any enemy underneath it — worth points, and they stay gone for a few seconds.

## Controls

| Input | Action |
|---|---|
| <kbd>←</kbd> <kbd>→</kbd> or <kbd>A</kbd> <kbd>D</kbd> | Walk along a girder |
| <kbd>↑</kbd> <kbd>↓</kbd> or <kbd>W</kbd> <kbd>S</kbd> | Climb a ladder |
| <kbd>Space</kbd> | Spray pepper (also starts the game) |
| <kbd>Enter</kbd> | Start the game |
| <kbd>P</kbd> | Pause / resume |

You can only step off a ladder where it crosses a girder, and you can only climb
where a ladder actually reaches — not every column connects every floor, which is
what makes the chase interesting.

## Scoring

| Event | Points |
|---|---|
| Ingredient dropped a floor | 50 |
| Enemy squashed by a falling ingredient | 100 |
| Burger completed | 500 |
| Level cleared | 1000 |

The best score is kept in `localStorage`. Each new level reuses the same map with
more enemies (up to five) moving faster, and refills your peppers.

## Development

The implementation is documented in [DESIGN.md](DESIGN.md). Tests:

```powershell
npx playwright test BurgerTime/tests/
```
