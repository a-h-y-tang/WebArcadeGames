# Soda Tapper

Four counters. One server. A bar full of people who will not wait.

Customers walk in at the far end of each counter and march steadily toward the
taps. Slide a full mug down the right counter to meet them: they catch it,
stagger backwards while they drink, and then shove the empty mug straight back
at you. Keep every counter clear and the tips keep coming.

## How to play

Open `index.html` in a browser — there is no build step and no server needed.

| Input | Action |
|---|---|
| <kbd>&uarr;</kbd> / <kbd>&darr;</kbd> or <kbd>W</kbd> / <kbd>S</kbd> | Move between counters |
| <kbd>Space</kbd> | Pour and slide a mug (also starts the game and advances a level) |
| Click a counter | Move to that counter and pour |
| <kbd>P</kbd> | Pause / resume |

## Rules

You start with three lives and lose one each time:

- a customer reaches your end of a counter and grabs you,
- a full mug slides all the way off the far end and smashes, or
- an empty mug comes back to the taps while you are at another counter.

A served customer is pushed back a fixed distance, so a new arrival costs one
mug while someone who has reached the taps costs four. Clear every customer in
the wave to finish the level; the crowds get bigger and faster from there.

| Event | Points |
|---|---|
| Mug caught by a customer | 50 |
| Empty mug caught at the taps | 25 |
| Customer leaves happy | 150 |
| Level cleared | 300 |

Your best score is kept in the browser's local storage.

## Tests

From the repository root:

```powershell
npx playwright test SodaTapper/tests/
```

The suite drives the game's own simulation step by step — see `DESIGN.md` for
how the state is laid out and why.
