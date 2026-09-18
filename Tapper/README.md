# Tapper

A four-lane serving game on an HTML5 canvas. You work the tap end of four long
bars. Customers shoulder in through the door at the far end and walk steadily
towards you — pour a mug and it slides down the bar, and whoever catches it is
shoved back while they drink. Shove a customer clean off the far end and they
leave happy. Every mug they finish comes sliding straight back: catch it at the
taps or it shatters.

![Tapper](screenshot.png)

## Playing

Open `index.html` in any modern browser. No build step and no server required.

## Controls

| Input | Action |
|---|---|
| `↑` `↓` / `W` `S` | move to the bar above / below |
| `Space` | pour a mug (also starts the game when idle or after game over) |
| `Enter` | start / restart |
| `P` | pause / resume |
| Click / tap a bar | move to that bar; click your own bar to pour |

## How to play

**Serve, don't just stall.** A mug shoves whoever catches it about 96 px back
down the bar. Push a customer past the far end and they leave served, worth 100
points. A customer caught right at the door goes down in one mug; one you let
walk halfway up the bar takes three or four — and every one of those mugs comes
back at you. Meeting them early is the whole game.

**Catch the empties.** A customer who drinks but is *not* pushed off the end
slides the empty mug back towards the taps. Be standing at that bar when it
arrives and you pocket 50 points; be on another bar and it shatters, costing a
life. This is what stops you from simply parking on one bar: serving the top bar
mortgages your next few seconds to it.

**Don't over-pour.** A mug nobody catches smashes at the far end of the bar and
costs a life, so pouring into an empty bar is never free. The tap also has a
short cooldown, and no more than three full mugs can be on one bar at a time.

**Mind who is drinking.** A customer mid-drink has both hands full, so a mug
slides straight past them to whoever is behind. That is how you reach the back of
a queue — but the mug will smash at the end of the bar if nobody back there
takes it. A mug that has already slipped past someone cannot be grabbed by them
on the rebound.

**They reach you, you lose.** Any customer who makes it to the taps hauls you
over the counter. That, a smashed empty and a wasted pour are the three ways to
lose one of your three lives. Each costs a moment's pause, then the current
wave restarts with the bar wiped clean.

**The shift gets busier.** Clear a wave and you bank a bonus of 250 × level.
Each level queues two more customers, they walk faster (30 px/s rising to a cap
of 78) and arrive more often (every 2.4 s down to 0.9 s). There is no last
level — you play until your lives run out. Your best score is kept in
`localStorage`.

## Scoring

| Event | Points |
|---|---|
| Customer served off the end of the bar | 100 |
| Empty mug caught at the taps | 50 |
| Wave cleared | 250 × level |

## Tests

From the repository root:

```powershell
npx playwright test Tapper/tests/
```

61 Playwright specs cover pouring and its limits, catching and drinking,
serving, empties, all three ways to lose a life, waves and levels, pausing, the
HUD, best-score persistence and rendering. See [DESIGN.md](DESIGN.md) for how
the code is laid out.
