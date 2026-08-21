# Soda Tapper

A four-counter bar game on an HTML5 canvas, in the mould of the arcade classic
*Tapper* — re-skinned as a soda fountain. You work the taps at the right-hand
end of four parallel counters. Thirsty customers push in from the far end and
walk steadily toward you; pull the tap and a full mug slides down to meet them.
They catch it, get shoved back while they drink, and lob the empty back at you —
and you have to be standing in the right lane to catch it.

![Soda Tapper](screenshot.png)

## Playing

Open `index.html` in any modern browser. No build step and no server required.

## Controls

| Input | Action |
|---|---|
| `↑` `↓` / `W` `S` | move between counters |
| `Space` | pull the tap (also starts the game when idle or after game over) |
| `Enter` | start / restart |
| `P` | pause / resume |
| Click a counter | move there and pour |

## How to play

**Serve.** A poured mug slides away from the taps until it reaches the customer
nearest the taps in that lane. They catch it and are shoved about a third of the
way down the counter while they drink. Keep pouring: a customer shoved off the
far end goes home happy and is out of your hair for the rest of the wave.

**Catch the empties.** Every mug a customer catches comes straight back at you a
moment later. If you are not standing at that counter when it arrives it smashes
on the floor and costs a life. This is the whole game: the mug you poured five
seconds ago is still in play, in a lane you have probably left since.

**Three ways to lose a life** — you have three:

| | |
|---|---|
| **Spill** | a full mug ran off the far end with nobody there to catch it |
| **Smash** | an empty came back to a counter you had left |
| **Grabbed** | a customer walked all the way to the taps |

Any of them clears the counters and restarts the wave; your score and wave
number survive.

**Waves.** Each wave is a fixed number of customers — six on the first, two more
each round, up to sixteen. Serve them all, catch every last empty, and you take
the wave bonus. Every round they arrive sooner and walk faster, though never
fast enough to outrun a mug.

## Scoring

| Event | Points |
|---|---|
| Customer catches a mug | 50 |
| You catch an empty | 25 |
| Customer sent home happy | 150 |
| Wave cleared | 250 × wave number |

Your best score is remembered in `localStorage`.

## Development

`DESIGN.md` explains the lane model, the serving rules, the wave structure and
the assumptions made while building it.

Tests are Playwright specs in `tests/`:

```powershell
npx playwright test SodaTapper/tests/
```

All game motion is expressed per-second and applied by `step(dt)`, and the specs
switch the `autoStep` hook off so they own the clock outright — nothing advances
between assertions.
