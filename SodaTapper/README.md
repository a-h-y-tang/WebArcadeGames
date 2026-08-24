# Soda Tapper

You are the only soda jerk in a very busy diner. Four counters, one of you,
and a queue that never stops.

Open `index.html` in any browser — no build step, no server.

## How to play

Customers walk in at the far end of a counter and march toward your station.
Slide a full mug down their counter to push them back. Push a customer off the
far end and they leave happy — and shove their empty mug back at you, which you
have to be standing in the right lane to catch.

Three things cost you a life:

- a customer reaches your station,
- a full mug runs off the far end of a counter and smashes,
- an empty mug slides past you and hits the floor.

Three lives, and the diner closes.

## Controls

| Key | Action |
|---|---|
| `↑` / `W` | move up one counter |
| `↓` / `S` | move down one counter |
| `Space` / `F` | pour and slide a mug — also starts the game |
| `P` | pause / resume |

## Scoring

| Event | Points |
|---|---|
| Customer served | 50 × level |
| Empty mug caught | 100 × level |
| Level cleared | 200 × level |

Level *n* needs `4 + 2n` customers served. Each level the customers walk faster
and arrive more often. Your best score is kept in the browser's local storage.

## Tips

- A customer who has just walked in is only one mug from the exit. One who has
  reached the middle of the counter will take two or three, so serve early.
- Every mug you pour comes back as an empty. Pouring into a lane you are about
  to leave is how runs end.
- Points are worth more on later levels, so surviving beats hoarding.

## Tests

```powershell
npx playwright test SodaTapper/tests/
```

## Design

See [DESIGN.md](DESIGN.md) for the geometry, the simulation loop and the
assumptions behind the rules.
