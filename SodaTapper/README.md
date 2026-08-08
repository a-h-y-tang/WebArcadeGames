# Soda Tapper

A four-lane counter-service arcade game, built with plain HTML5 canvas and
JavaScript — no build step, no dependencies. You are the soda jerk. Thirsty
customers push in through the doors on the **left** of each lane and shuffle
**right** toward your taps. Slide a mug down a lane, knock the customer back
toward the doors, and catch the empty they slide back at you.

Inspired by the 1983 coin-op *Tapper*.

![Soda Tapper screenshot](screenshot.png)

## How to play

Open `index.html` in any modern browser. Press **Space** (or click **Start
Game**) to begin.

| Key | Action |
|---|---|
| ↑ / W | Move up one lane |
| ↓ / S | Move down one lane |
| Space | Start the game / pour a mug |
| Click a lane | Jump to that lane and pour |
| P | Pause / resume |

- A mug knocks the customer it reaches back toward the doors and scores **10**
  points. Knock a customer all the way to the doors and they leave satisfied for
  another **50**.
- Every mug that connects sends an **empty** sliding back at you. Catch it by
  standing in that lane when it arrives for **25** points.
- You lose a life when a customer reaches the taps, when a mug slides down an
  empty lane and smashes at the doors, or when an empty comes back to a lane you
  aren't standing in. Losing a life sweeps every mug off the counter so you can
  recover.
- Clear all of a level's customers to move on: that's **100 × level** bonus
  points and one life back, up to 5. Each level the crowd walks faster and
  arrives more often.

Your best score is saved in the browser's `localStorage`.

## Files

| File | Purpose |
|---|---|
| `index.html` | HUD, canvas and overlay markup |
| `style.css` | Dark arcade styling |
| `game.js` | All game state, simulation and rendering |
| `DESIGN.md` | How the code works, and the assumptions behind it |
| `tests/soda-tapper.spec.js` | Playwright test suite |

## Tests

From the repository root:

```powershell
npx playwright test SodaTapper/tests/
```
