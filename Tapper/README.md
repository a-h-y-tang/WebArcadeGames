# Tapper

Work four bars at once: slide drinks to thirsty customers before they reach the
taps, and be standing in the right place to catch the empties they send back.

![Tapper](screenshot.png)

## Playing

Open `index.html` in any browser — no build step or server required.

## How to play

- Customers walk in from the left of each of the four bars and head for the
  taps. Serve them before they get there.
- <kbd>↑</kbd> / <kbd>↓</kbd> (or <kbd>W</kbd> / <kbd>S</kbd>) move the
  bartender between bars.
- <kbd>Space</kbd> (or a click on the canvas) pours a mug down the bar you are
  standing at.
- A served customer drinks, is pushed back down the bar, and slides an **empty
  mug** back toward you. Be on that bar to catch it.
- <kbd>P</kbd> pauses, <kbd>Enter</kbd> starts or restarts.

## Rules

You start with three lives. You lose one when:

- a poured mug reaches the far end of a bar without meeting anyone,
- an empty mug comes back to a bar you are not standing at, or
- a customer reaches the taps.

A mistake clears the room and the round carries on from where it was.

## Scoring

| Event | Points |
|---|---|
| Serving a customer | 100 |
| Catching an empty mug | 50 |
| Clearing a round | 500 |

Your best score is kept in `localStorage`.

## Rounds

Each round sends a bigger, faster crowd — 6 customers in round 1, growing by two
each round up to 20, with arrivals getting more frequent. Clear the whole crowd
to move on. Customers never move faster than a poured mug, so there is always a
way to reach them.

## Tests

```powershell
npx playwright test Tapper/tests/
```

See [DESIGN.md](DESIGN.md) for how the code works.
