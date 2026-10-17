# Soda Tapper

Four counters, one pair of hands. A single-screen reflex game in the spirit of
the 1983 arcade cabinet *Tapper*.

Open `index.html` in any browser — no build step, no server.

![Soda Tapper](screenshot.png)

## How to play

Thirsty customers come in through the doors at the far end of each counter and
walk steadily towards your taps. A drink slid the length of the counter stops
one of them: they catch it, skid backwards while they drink, and hand the glass
back. Push a customer all the way out of the door and they leave satisfied.

The empty glass is the other half of the job. It comes sliding back down the
counter towards you, and it only gets caught if you are standing at that tap
when it arrives. Every drink you pour is therefore a second appointment a few
seconds later, in a lane you may well have had to leave in the meantime.

Three things cost you a life:

- a customer reaching the taps,
- a drink sliding off the far end with nobody to catch it,
- an empty glass arriving at a tap you are not standing at.

Losing a life clears the bar, so the wave resumes from a clean counter. Lose
all three and the shift is over.

Clear everyone in the wave and the next shift starts: more customers, arriving
sooner, walking faster.

## Controls

| Input | Action |
|---|---|
| `↑` `↓` or `W` `S` | step between counters |
| `Space` / `Enter` | pour a drink down the current counter |
| `Space` / `Enter` | start, or restart after the shift ends |
| `P` | pause |

Standing in a lane is what catches its empties — there is no separate catch
key.

## Scoring

| Event | Points |
|---|---|
| a customer catches a drink | 50 |
| a customer leaves through the door | 100 |
| an empty glass caught at the taps | 10 |
| wave cleared | 200 |

The best score is kept in `localStorage` under `sodatapper-best`.

## Strategy

- **Do not over-pour.** A second drink aimed at a customer the first one is
  about to push out of the door has nothing to hit, and a drink that reaches
  the far end costs a life. One drink in flight per customer is the rule.
- **Serve the lane you can get back to.** The empty returns roughly as fast as
  the drink went out, so pouring into a far lane and then running somewhere
  else is how most shifts end.
- **Nearest customer first.** A drink is taken by the customer closest to the
  taps, so the lane's front runner is always the one you are pushing back.
- **Doorway customers are cheap.** Someone who has just walked in needs a
  single drink to be pushed straight back out — 150 points for one pour.

## Files

| File | What it holds |
|---|---|
| `index.html` | canvas, HUD and overlay markup |
| `style.css` | the cabinet styling around the canvas |
| `game.js` | the whole game: state, simulation, rendering, input |
| `DESIGN.md` | how the code is put together, and the assumptions behind it |
| `tests/sodatapper.spec.js` | the Playwright suite (77 tests) |

## Tests

From the repository root:

```powershell
npx playwright test SodaTapper/tests/
```
