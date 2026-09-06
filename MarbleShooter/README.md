# Marble Shooter

A Zuma-style marble popper. A chain of coloured marbles crawls along a spiral
track toward a pit at its centre. You sit in the middle on a rotating shooter —
fire marbles into the chain and pop them before the leading marble drops in.

![Marble Shooter](screenshot.png)

## How to play

Open `index.html` in any browser. No build step, no server.

1. Aim with the mouse (or nudge with the arrow keys).
2. Click or press <kbd>Space</kbd> to fire the marble loaded in the shooter.
3. Land three or more of the same colour next to each other and they pop.
4. Clear every marble in the level to move on. If the leading marble reaches the
   pit, the run is over.

## Controls

| Input | Action |
|---|---|
| Mouse move | Aim |
| Mouse click | Fire |
| <kbd>←</kbd> / <kbd>→</kbd> | Nudge the aim |
| <kbd>Space</kbd> | Start the game / fire while playing |
| <kbd>S</kbd> | Swap the loaded marble with the queued one |
| <kbd>P</kbd> | Pause / resume |

## Scoring

Each pop scores `marbles × 10 × level`, multiplied again for every extra pop in
a chain reaction — so a shot that sets off two runs is worth far more than two
separate shots. Your best score is kept in `localStorage`.

## Tips

* **Don't spray.** Every marble that lands without popping shoves the whole
  chain one marble-width closer to the pit. A shot that pops at the front of the
  chain costs you nothing at all.
* **Set up chain reactions.** Splitting a long run so two same-coloured groups
  end up touching pops both, with a rising multiplier.
* The queued marble is shown bottom-left — press <kbd>S</kbd> when the loaded
  one is useless.
* You are only ever handed colours that are still on the track, so there are no
  dead marbles.

## Levels

Each level queues more marbles, crawls faster and eventually adds more colours
(three at level 1, up to five). There is no final level — play until you lose.

## Design

See [DESIGN.md](DESIGN.md) for how the track, the chain and the matching logic
work.

## Tests

From the repository root:

```powershell
npx playwright test MarbleShooter/tests/
```
