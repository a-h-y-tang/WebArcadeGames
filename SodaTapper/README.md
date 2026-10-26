# Soda Tapper

Four counters, one soda jerk, and mugs going both ways. Customers push in through
the doors at the **left** of each counter and walk right toward your taps. Slide a
full mug down to meet them and they stop, drink, and wander back out — but the
empty mug they leave behind comes sliding straight back at you, and it has to be
caught.

## How to play

1. Press **Space**, or click **Start Game**.
2. Move between counters with **↑/↓**, **W/S**, or by moving the mouse over the bar.
3. Press **Space** or click to pour a mug down the counter you are standing at.
4. Stand in a counter's lane to catch the empty mug coming back down it.

Three lives, five waves. Each wave sends more customers, walking faster.

## What costs you a life

| Mistake | What happens |
|---|---|
| A customer reaches the taps | they haul you over the counter |
| A full mug runs the whole counter | it shatters on the floor |
| An empty mug comes back to an empty counter | it shatters on the floor |

A life lost does not clear the bar — the rush carries right on, so the mug you
poured a moment ago is still coming back.

## Scoring

| Event | Points |
|---|---|
| Serving a customer | 50 |
| Serving one near the taps (close call) | +50 |
| Catching an empty mug | 25 |
| Finishing a wave | 100 × wave + 50 × lives left |

Your best score is remembered between sessions.

## Controls

| Input | Action |
|---|---|
| `↑` `↓` / `W` `S` | move between counters |
| Mouse over the bar | jump to the counter under the pointer |
| `Space` / click | pour a mug (or start / continue on an overlay) |
| `P` | pause and unpause |

## Tips

- Every mug is two errands: one going out, one coming back. Pour in the lane you
  intend to still be standing in.
- Letting a customer get close before serving pays double — but the grab line is
  only a little past the bonus line.
- Only *advancing* customers take a mug, so a second pour into a lane where
  someone is already drinking sails past them to whoever is behind.
- A customer walking back out is harmless. Spend that time on another counter.

## Files

- `index.html` — page shell, HUD, canvas and overlay
- `style.css` — cabinet styling
- `game.js` — simulation and rendering
- `DESIGN.md` — how the code works, and the assumptions behind it
- `tests/soda-tapper.spec.js` — Playwright suite

Run the tests from the repository root:

```powershell
npx playwright test SodaTapper/tests/
```
