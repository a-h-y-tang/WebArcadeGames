# Soda Rush

A four-counter diner shift on an HTML5 canvas. You are the only server behind
the taps; thirsty customers shuffle up four counters towards you. Slide sodas
down to meet them, then be standing in the right place when the empties come
rolling back.

![Soda Rush](screenshot.png)

## Playing

Open `index.html` in any browser — no build step and no server required.

## Controls

| Input | Action |
|---|---|
| <kbd>↑</kbd> / <kbd>W</kbd> | Move up one counter |
| <kbd>↓</kbd> / <kbd>S</kbd> | Move down one counter |
| <kbd>Space</kbd> | Pour a soda and slide it down the current counter |
| <kbd>P</kbd> | Pause / resume |
| <kbd>Space</kbd> | Start a shift (or start a new one after a game over) |

## How it works

- Customers come in through the door on the left and walk towards your taps.
- <kbd>Space</kbd> pours a soda into the counter you are standing at. It slides
  away from you; the first thirsty customer it meets grabs it and is shoved back
  towards the door.
- A customer with nothing left to drink walks out — worth `100 × level` — and
  shoves their **empty mug** back up the counter. Be standing at that counter
  when it arrives to catch it for 50 points.
- From level 3 customers need two sodas each: the first shoves them back but
  leaves them thirsty.

## Losing a life

You have three, and there are three ways to spend one:

1. A customer reaches your taps.
2. A soda slides past everybody and smashes off the far end of the counter.
3. A returning empty rolls in to a counter you are not standing at.

Losing a life clears both counters and the wave re-sends whoever was still
owed a drink.

## Waves

Each level is one wave. Serve `4 + 2 × level` customers and clear the counters
to move on. Every level sends more customers, walking faster, arriving sooner —
and from level 3, twice as thirsty.

Your best score is kept in `localStorage`.

## Tests

71 Playwright specs, written before the implementation:

```powershell
npx playwright test SodaRush/tests/
```

See [DESIGN.md](DESIGN.md) for the code structure, the simulation model and the
assumptions made while building it.
