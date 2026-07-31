# Burger Time

Build three burgers by trampling their ingredients down onto the plates — and
stay ahead of the food that is chasing you.

Open `index.html` in any browser. No build step, no server.

## How to play

Three burgers hang in pieces across four floors of girders. Walk the **entire
width** of an ingredient and it drops to the level below. Drop every layer onto
its plate at the bottom of the screen to clear the level.

An ingredient that lands on another ingredient knocks that one down as well, so
a well-timed drop from the top floor can cascade a whole burger onto its plate
in one move — that's where the big scores are.

Meanwhile a hot dog, an egg and a pickle are hunting you. Touching one costs a
chef. You get five shakes of pepper per level: a cloud thrown in front of you
freezes anything it touches for a few seconds. Better still, drop an ingredient
on an enemy — the first one caught is worth 200, and each extra one caught by
the same piece doubles that.

## Controls

| Key | Action |
|---|---|
| `←` `→` / `A` `D` | Walk along a floor |
| `↑` `↓` / `W` `S` | Climb a ladder |
| `Space` | Throw pepper |
| `Enter` / `Space` | Start, or continue to the next level |
| `P` | Pause |

Movement is sticky: the chef keeps going in the last direction you pressed until
you press another one or the way is blocked.

## Scoring

| Event | Points |
|---|---|
| Ingredient lands on a floor | 50 |
| Ingredient lands on a plate | 100 |
| Enemy squashed by a falling ingredient | 200, doubling per extra enemy in the same drop |
| Level cleared | 1000 |

Your best score is saved in the browser.

## Levels

The burger layouts change every level and cycle through three arrangements.
Level 1 puts one ingredient on every floor, which makes the full cascade
available; later levels leave gaps and stack layers, so you have to make several
trips. A fourth enemy joins on level 2, a fifth on level 3, and from level 3 they
move twice as fast.

## Tests

```powershell
npx playwright test BurgerTime/tests/
```

See [DESIGN.md](DESIGN.md) for how the code is put together.
