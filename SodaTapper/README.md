# Soda Tapper

![Soda Tapper](screenshot.png)

Four bars, one bartender, and a room full of people who are not leaving until
they get a drink. Patrons walk in through the doors on the right and march on
your taps. Fill a mug, slide it down the bar, and whoever catches it is shoved
back toward the door while they drink. Shove them all the way out and they
leave happy.

## How to play

1. Press **Space**, or click **Start Game**.
2. Move between the four bars with **↑/↓** (or **W/S**).
3. Press **Space** to pour a mug and slide it down the bar you are standing at.
4. Catch the empties coming back — stand in that lane before they reach the taps.

Three lives, five rounds. Each round brings faster patrons arriving more often.

## What costs a life

| Mistake | Why |
|---|---|
| A patron reaches the taps | they came for a drink and you did not have one |
| A mug slides off the far end | nobody was there to catch it |
| An empty mug reaches the taps in a lane you are not in | it hits the floor |

Lose a life and the bars are wiped clean: every mug is gone and every surviving
patron is sent back to the door, so you restart the traffic but keep the
patrons you already served.

## Scoring

| Event | Points |
|---|---|
| A patron catches a mug | 50 |
| You catch an empty mug | 25 |
| A patron leaves satisfied | 200 |
| Clearing a round | 500 × round number |

Your best score is remembered between sessions.

## Controls

| Input | Action |
|---|---|
| `↑` `↓` / `W` `S` | move between bars |
| `Space` | start, pour a mug, or dismiss an overlay |
| Click a bar | move to that bar and pour |
| `P` | pause and unpause |

## Tips

- Serve a patron the moment they walk in and one mug is enough to push them
  straight back out of the door.
- Every mug you serve is an empty you will have to catch, so do not pour four
  at once across four bars unless you can be in all four lanes in time.
- A patron who is drinking is standing still — that is time to deal with the
  other three bars.
- The progress strip under the bars shows how much of the round is left.

## Files

- `index.html` — page shell, HUD, canvas and overlay
- `style.css` — cabinet styling
- `game.js` — simulation and rendering
- `DESIGN.md` — how the game works internally, and the assumptions behind it
- `tests/soda-tapper.spec.js` — Playwright suite

Run the tests from the repository root:

```powershell
npx playwright test SodaTapper/tests/
```
