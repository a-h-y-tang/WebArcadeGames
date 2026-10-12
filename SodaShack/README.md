# Soda Shack

Four counters, one barkeep, and a door that will not stop opening. Pour mugs
down a lane to stop the patrons walking at you — then be standing in that lane
when the empty comes sliding back.

Open `index.html` in any browser. No build step, no server.

## How to play

Patrons walk in at the door end of a counter and head for your taps. You stand
at the tap end and can only cover **one lane at a time**.

- **Pour** a mug and it slides down your lane. The patron nearest the taps
  catches it, is pushed back down the bar, and drinks.
- A moment later that patron **slides the empty mug back at you**. Be in the
  lane to catch it.
- Clear the whole wave to finish the shift. The next shift sends more patrons,
  arriving sooner and walking faster.

You lose one of your three lives when:

- a patron reaches your taps,
- a full mug runs off the far end of a counter (you poured into an empty lane),
- an empty mug arrives in a lane you are not standing in and smashes.

A lost life clears the counters and restarts the same wave — your score stays.

## Controls

| input | action |
|---|---|
| `↑` / `↓` or `W` / `S` | pick a lane |
| mouse move | pick the lane under the pointer |
| `Space` / `Enter` / click | pour and serve |
| `P` | pause |

Space also starts a shift and moves on from the shift-clear and game-over
screens.

## Scoring

| event | points |
|---|---|
| serving a patron | 50 |
| catching an empty mug | 25 |
| clearing a shift | 100 × shift + 50 per life left |

Your best score is remembered in the browser.

## Files

| file | what it holds |
|---|---|
| `index.html` | page, HUD and overlay markup |
| `style.css` | shack styling |
| `game.js` | the whole game: rules, fixed-timestep simulation and canvas drawing |
| `DESIGN.md` | how the code works, and the assumptions behind the rules |
| `tests/soda-shack.spec.js` | the Playwright suite the game was built against |

## Tests

From the repository root:

```powershell
npx playwright test SodaShack/tests/
```
