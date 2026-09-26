# Peg Pop

Aim, drop, and let physics do the rest. A launcher at the top of the board fires
a steel ball into a field of pegs; gravity and ricochets carry it from there. Your
job is to clear every **orange** peg before you run out of balls.

## How to play

1. Press **Space**, or click **Start Game**.
2. Swing the launcher with **←/→**, **A/D**, or by moving the mouse over the board.
3. Press **Space** or click the board to fire.
4. Clear all the orange pegs to finish the level. Five levels make a full run.

Ten balls per level. Running out of balls with orange pegs still standing ends the
run, and your best score is remembered between sessions.

## Pegs and points

| Peg | Points | Extra |
|---|---|---|
| Blue | 10 | a bumper to steer the ball with |
| Green | 50 | gives a ball back |
| Orange | 100 | must be cleared to finish the level |

Clearing a level pays a bonus of **250 × every ball still in hand**, so a clean
board is worth far more than a slow one. The green **free-ball bucket** sliding
along the bottom returns any ball that drops into it, so watch its timing before
you take a shot you are not sure of.

## Controls

| Input | Action |
|---|---|
| `←` `→` / `A` `D` | swing the launcher (tap to nudge, hold to sweep) |
| Mouse over the board | aim at the pointer |
| `Space` / click | start, fire, or dismiss an overlay |
| `P` | pause and unpause |

## Tips

- Pegs are bumpers as much as targets: a blue peg above an orange cluster can
  drop the ball straight into it.
- The walls bounce, so a steep shot into the side can reach pegs the launcher
  cannot see directly.
- Late in a board, aim for a peg that will kick the ball toward the bucket — a
  refunded ball is effectively a free shot.

## Files

- `index.html` — page shell, HUD, canvas and overlay
- `style.css` — cabinet styling
- `game.js` — simulation and rendering
- `DESIGN.md` — how the game works internally, and the assumptions behind it
- `tests/peg-pop.spec.js` — Playwright suite

Run the tests from the repository root:

```powershell
npx playwright test PegPop/tests/
```
