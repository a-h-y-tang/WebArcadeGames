# Soda Tapper

A single-screen arcade game in the spirit of *Tapper*. You work four counters on
your own: slide mugs of soda down to shove the crowd back out the door, and
catch the empties they throw back before they hit the floor.

Open `index.html` in any browser — no build step, no server.

## How to play

Customers walk in at the far end of a counter and head for your taps. Pour a mug
and it slides down the counter; when it reaches a customer they drink it and get
shoved back. Keep shoving and they leave satisfied — and send the empty mug back
up the counter to you.

You lose a life when:

- a poured mug reaches the far end without meeting anyone and smashes,
- an empty mug arrives at the taps and you are standing at a different counter,
- a customer reaches the taps.

Three lives. Clear every customer in a wave and the next wave arrives with more
people, walking faster.

## Controls

| Key | Action |
|---|---|
| <kbd>↑</kbd> / <kbd>W</kbd> | move up one counter |
| <kbd>↓</kbd> / <kbd>S</kbd> | move down one counter |
| <kbd>Space</kbd> | pour and slide a mug (also starts the game) |
| <kbd>Enter</kbd> | start / restart |
| <kbd>P</kbd> | pause / resume |

## Scoring

| Event | Points |
|---|---|
| Customer served out the door | 100 |
| Empty mug caught | 50 |
| Wave cleared | 250 |

Your best score is kept in `localStorage`.

## Tips

- A customer near the far end only needs one mug; one who has walked halfway
  needs two or three. Pour early.
- Every mug you pour comes back at you as an empty. Plan where you will be
  standing when it arrives.
- Don't hold the pour key — the cooldown wastes the extra presses, and mugs sent
  down an empty counter cost a life.

## Development

Design notes are in [DESIGN.md](DESIGN.md). Playwright specs live in `tests/`:

```powershell
npx playwright test SodaTapper/tests/
```
