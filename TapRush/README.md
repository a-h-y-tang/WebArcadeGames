# Tap Rush

A four-lane arcade bar sim. Thirsty patrons push in from the door and walk down
each counter toward you; pour mugs to send them back out, and catch the empties
they slide back before they smash on the floor.

Open `index.html` in any browser — no build step, no server.

## How to play

You are the bartender at the left end of four counters, and you can only stand
at one of them at a time.

| Input | Action |
|---|---|
| <kbd>↑</kbd> / <kbd>W</kbd> | move up one counter |
| <kbd>↓</kbd> / <kbd>S</kbd> | move down one counter |
| <kbd>Space</kbd> | pour a mug down the current counter (also starts the game) |
| <kbd>P</kbd> | pause / resume |

A poured mug slides toward the door. A patron it reaches grabs it, stops for a
swig and is shoved back toward the exit. Patrons on later waves want two or
three mugs before they have had enough; the golden pips over a patron's head
show how many are still owed. A satisfied patron heads for the door — and slides
their empty mug back down the counter at you.

## Losing a life

You start with three lives and lose one every time you let the bar get away from
you:

* a patron walks all the way to your end of a counter,
* a mug you poured slides off the far end and smashes, or
* an empty mug comes back down a counter you are not standing at.

Lose all three and the rush is over.

## Scoring

| Event | Points |
|---|---|
| Patron catches a mug | 25 |
| Patron leaves the bar | 75 |
| Empty mug caught | 25 |
| Wave cleared | 200 × wave number |

Clear every patron in a wave and the next one arrives thirstier, faster and in
greater numbers. Lives are never refilled, and your best score is kept in the
browser.

## Under the hood

See [DESIGN.md](DESIGN.md) for the simulation model, the constants behind the
balance, and the assumptions taken while building it. Tests live in
[tests/tap-rush.spec.js](tests/tap-rush.spec.js) and run with the repo-wide
Playwright setup:

```powershell
npx playwright test TapRush/tests/
```
