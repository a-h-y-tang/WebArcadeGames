# Tapper

A four-lane bar-serving arcade game. You are the only bartender on shift, and
the customers are not patient.

Open `index.html` in any browser — no build step or server required.

## How to play

Thirsty customers push in from the far end of each of the four bars and shuffle
steadily toward you. Slide a mug down a bar and the customer at the front grabs
it, staggers backwards while drinking, and then shoves the empty back at you.

- **Serve** a customer enough times to push them off the end of the bar and they
  leave happy — worth 150 points.
- **Catch** every empty mug that comes back: stand in that lane before it
  reaches your end. A caught empty is worth 50 points.
- **Clear** all the customers in a wave for a bonus of 300 × level, then the
  next round starts with more customers arriving more often.

## You lose a life if

- a customer reaches your end of a bar,
- a mug you poured runs the whole length of a bar without anybody taking it, or
- an empty mug comes back to a bar you are not standing at and smashes.

Three lives, and the run is over. Your best score is kept in the browser.

## Controls

| Input | Action |
|---|---|
| ↑ / W | Move up one bar |
| ↓ / S | Move down one bar |
| Space | Pour a mug down the current bar |
| Enter / Space | Start (from the title or game-over screen) |
| P | Pause / resume |

The **Start Game** button on the overlay does the same as Enter.

## Tips

- Do not spam the tap. A wasted mug costs a life just as surely as a customer
  reaching the bar, so only pour into a lane that has someone in it.
- Serve the bar with the customer nearest to you first — a mug always goes to
  the *front* customer in its lane, and that is the one about to reach you.
- Watch for empties before they are sent: a customer who has just finished
  drinking is about to hand one back, so plan to be in that lane.
- A customer standing near the far end only needs one mug to be pushed out.
  Clearing those cheaply frees you up for the dangerous end of the bar.

## Development

Playwright specs live in `tests/tapper.spec.js` and are picked up by the repo's
root config:

```powershell
npx playwright test Tapper/tests/
```

See [DESIGN.md](DESIGN.md) for how the code is put together.
