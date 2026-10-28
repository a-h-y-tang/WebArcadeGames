# Soda Tapper

Four lanes of thirsty patrons, one pair of taps, and three spare mugs. Patrons
walk in through the doorway on the left and head straight for your taps. Slide a
full mug down their lane to push them back out of the door — then be standing in
the right lane to catch the empty they send sliding back.

## How to play

1. Press **Space**, or click **Start Game**.
2. Pick a lane with **↑/↓**, **W/S**, or by moving the mouse over the bar.
3. Press **Space** or click the bar to pour a mug into that lane.
4. Keep pouring until every patron has been pushed out of the door, and catch
   every empty before it runs off the end of the bar.

A wave ends once the last arrival has been dealt with and the bar is clear. The
crowd gets bigger and quicker every wave, and your best score is remembered
between sessions.

## What costs you a mug

You have three spare mugs — three lives — and three ways to lose one:

| Mishap | Why |
|---|---|
| A patron reaches the taps | nobody served them in time |
| A full mug runs off the far end | you poured into an empty lane |
| An empty mug runs past you | you were standing in the wrong lane |

That last pair is the whole game: pouring is never free, so a panicked extra mug
in the wrong lane costs exactly as much as a patron you ignored.

## Points

| Event | Points |
|---|---|
| Patron pushed out of the door | 150 |
| Empty mug caught | 25 |
| Wave finished | 200 × wave number |

## Controls

| Input | Action |
|---|---|
| `↑` `↓` / `W` `S` | step between the four lanes |
| Mouse over the bar | jump to the lane under the pointer |
| `Space` / click | start, pour, or dismiss an overlay |
| `P` | pause and unpause |

## Tips

- One mug is rarely enough. A single mug buys about three quarters of a second
  of drinking, so a patron who is already halfway down the bar needs two or
  three to make it back out of the door.
- Pour, then move. A mug takes about two and a half seconds to cross the bar,
  which is plenty of time to go collect an empty from another lane.
- Watch the lane a patron is leaving: the empty they send back arrives while you
  are still busy somewhere else.
- A nearly-served patron is worth more than a fresh one. Finish the lane you
  started before opening a new front.

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
