# Soda Tapper

A four-counter soda bar in the spirit of the 1983 arcade cabinet *Tapper*. You
are the only soda jerk on shift, patrons keep walking in, and the glassware
never stops coming back at you.

Open `index.html` in any browser — no build step, no server.

![Soda Tapper](screenshot.png)

## How to play

Patrons shove in at the far end of a counter and walk steadily toward the taps
where you stand. Slide a full mug down their counter and they catch it, stagger
backwards while they drink, and send the empty glass sliding back at you.

Three mistakes cost a life, and they pull against each other:

- **A patron reaches the taps.** They grab you by the apron. Serve them before
  they get there.
- **A mug smashes on the far end.** A mug you slide down a counter with nobody
  on it runs off the end and shatters, so you cannot just hammer the tap.
- **An empty hits the floor.** Every glass you serve comes back. Be standing in
  that lane when it arrives or it smashes.

Some patrons want a second round: they drink, send the glass back, and start
walking again. Clear every patron on the level and the next shift opens with
more of them, walking faster.

## Controls

| Input | Action |
|---|---|
| `↑` `↓` or `W` `S` | move to the counter above or below |
| `Space` | pour and slide a mug down your counter |
| Click the bar | pour (same as `Space`) |
| `Space` / `Enter` | start, or restart after game over |
| `P` | pause |

## Scoring

| Event | Points |
|---|---|
| Mug served | 50 |
| Empty glass caught | 25 |
| Patron leaves satisfied | 100 |
| Level cleared | 750 |

Your best score is kept in the browser under `sodatapper-best`.

## Tips

- Serve the patron nearest the taps: a mug is stopped by the first one it
  reaches, so the one at the back is not in danger yet anyway.
- Count your glassware. Every mug you pour is an empty you owe yourself in two
  or three seconds, and they arrive in the order you served them.
- A patron being shoved back by a drink is free time. Spend it in another lane.
- Do not pour into a lane you have just cleared — that mug has nothing to stop
  it and the smash costs the same as being grabbed.

## Development

The game is one classic script (`game.js`) with no modules and no build, so the
Playwright specs in `tests/` can reach the state as globals and drive the
simulation frame by frame through `step(dt)` with the real clock switched off
(`autoStep = false`).

```powershell
npx playwright test SodaTapper/tests/
```

`DESIGN.md` explains how the code is put together and lists the assumptions
behind this version of the game.
