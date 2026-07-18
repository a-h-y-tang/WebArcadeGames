# Galaga

A single-file HTML5 canvas homage to Namco's 1981 arcade shooter. A swarm of
alien bugs hovers at the top of the screen, swaying side to side — then, one by
one, they **peel off and dive**, swooping down at your fighter in curving attack
runs while firing. Fly your fighter along the bottom, shoot the swarm out of the
sky, and clear every wave.

## How to play

Open `index.html` in any modern browser — no build step or server required.

| Input                | Action                          |
|----------------------|---------------------------------|
| ← / → or A / D       | Move the fighter left / right   |
| Space                | Start the game / fire           |
| P                    | Pause / resume                  |
| Start button         | Start / resume / play again     |

Space does double duty: it starts the game from the idle or game-over screen,
and while the game is running it fires your guns. You may have **two** shots in
flight at once — Galaga's signature firepower.

## Rules

- Shoot aliens to score. Top rows are worth more, and a **diving** alien is
  worth **double** — risky targets pay off.
- The formation only sways left and right; it never marches down at you.
- Aliens break formation on a timer to dive-bomb your fighter. A diving alien
  that rams you, or a bomb that hits you, costs a life and scatters the
  attackers. A diving alien that misses loops back to its slot.
- Destroy the entire swarm to advance to the next, faster, more aggressive wave.
- The game ends when you lose your last life.
- Your best score is saved in the browser via `localStorage`.

## How it differs from Space Invaders

Galaga is a distinct game, not a reskin: the formation never descends, enemies
attack by **diving** in curved swoops (and can ram you), you get **two** shots
at once, and diving aliens score double. See [DESIGN.md](DESIGN.md) for the full
comparison and the code structure.

## Development

Tests are written with Playwright and live in `tests/`. From the repo root:

```powershell
npx playwright test Galaga/tests/
```
