# Tapper

A four-counter soda fountain. You are the only person behind the bar, thirsty
patrons keep coming through the door, and the only thing keeping them back is
root beer sliding down the woodwork.

Open `index.html` in any browser — no build step, no server.

## How to play

Patrons enter at the far (left) end of each of the four counters and walk toward
the taps where you stand. Slide a mug down a counter and the patron who catches
it is knocked back a few paces while they drink — knock one all the way out of
the door and they leave happy.

The catch: every mug a patron drinks comes sliding straight back at you as an
empty. Be standing on that counter when it arrives, or it shatters on the floor.

### Losing a life

- a patron reaches you at the taps
- a mug runs the whole counter without finding anyone and drops off the end
- an empty mug reaches the taps while you're on another counter

Three lives. When they're gone the shift is over.

### Clearing a shift

Each shift has a quota — six patrons on shift one, two more each shift after.
Serve the quota *and* clear the bar (no patrons, no mugs still sliding either
way) and the next shift starts, worth a 500 point bonus. Patrons arrive faster
and walk faster every shift.

### Scoring

| Event | Points |
|---|---|
| A patron catches a mug | 50 |
| A patron is served out of the door | 200 |
| An empty mug is caught | 25 |
| A shift is cleared | 500 |

Your best score is kept in the browser's local storage.

## Controls

| Key | Action |
|---|---|
| `↑` / `W` | move up one counter |
| `↓` / `S` | move down one counter |
| `Space` | pour and slide a mug |
| `P` | pause / resume |
| `Enter` | start, or resume from pause |

Mouse or touch also works: click a counter to move to it, click again to serve.

## Reading the bar

- The counter you're standing at is lit in amber along its top edge.
- The tap end of a counter glows red when a patron is getting close to you.

## Tips

- Empties are the real clock. Every mug you pour is a mug you have to be
  standing in the right place to catch a couple of seconds later.
- A patron near the door only needs one more mug to be pushed out; a patron near
  the taps needs several. Clear the near ones first when you can.
- Don't pour into an empty counter — a mug that meets nobody costs a life.

## Development

Tests are Playwright specs in `tests/` and run from the repository root:

```powershell
npx playwright test Tapper/tests/
```

`DESIGN.md` explains how the code is put together, including how the tests take
over the clock to keep simulations deterministic.
