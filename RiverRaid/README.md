# River Raid

A vertical-scrolling river flight on an HTML5 canvas. You fly upstream along a
river that is carved fresh every game — the banks meander, sandbanks split the
channel in two, and every section ends at a bridge that has to be blown out of
the way before you reach it. The tank drains the whole time, and the only fuel
in the world is floating in the river ahead of you.

![River Raid](screenshot.png)

## Playing

Open `index.html` in any modern browser. No build step and no server required.

## Controls

| Input | Action |
|---|---|
| `←` `→` / `A` `D` | steer across the river |
| `↑` / `W` | throttle up |
| `↓` / `S` | throttle down |
| `Space` | fire (also starts the game when idle or after game over) |
| `Enter` | start / restart |
| `P` | pause / resume |

## How to play

**Stay on the water.** Touching either bank or an island costs a life. The banks
move, so a channel that looks wide now may be narrowing by the time you get
there — read the river a screen ahead, not under your nose.

**Fuel is the clock.** A full tank is about twenty seconds of cruising, and the
gauge along the bottom of the canvas is the only warning you get. Fuel depots
are the red `F` tanks in the river: fly over one and it fills, and because the
refill counts contact time, **throttling down over a depot fills far more than
sailing over it at speed**. Shooting a depot is worth 80 points — and burns the
fuel you were about to take. That trade is the whole game.

**Blow the bridge.** Every section of river ends at a bridge spanning the water.
It is solid: fly into it and you lose a life. Shoot it and you score 500 and the
section counter ticks over. The river straightens out for a run before each
bridge — that straight stretch is your cue that one is coming.

**Pick your targets.** Ships are worth 30, helicopters 60, enemy jets 100. They
patrol across the river and get faster each section. Everything you shoot is
also one fewer thing to fly around.

## Scoring

| Target | Points |
|---|---|
| Ship | 30 |
| Helicopter | 60 |
| Enemy jet | 100 |
| Fuel depot | 80 (and you lose the fuel) |
| Bridge | 500 (opens the next section) |

Your best score is kept in the browser's local storage.

## Tests

```powershell
npx playwright test RiverRaid/tests/
```

See [DESIGN.md](DESIGN.md) for how the river is generated and how the code is
laid out.
