# Soda Tapper

A four-lane bar-service arcade game in the spirit of *Tapper*. You are the
bartender; they are thirsty; the bar is only so long.

Open `index.html` in any browser — no build step, no server.

![Soda Tapper](screenshot.png)

## How to play

Customers file in from the far end of each of the four bars and walk steadily
toward you. Slide a mug down a lane and the nearest customer in it grabs the
drink, stops to drink it, and staggers back the way they came. Keep pushing and
they eventually fall off the far end of the bar — served, and worth points.

Every drink comes back at you. A customer who finishes a mug sends the empty
gliding down the bar; be standing in that lane when it arrives and you catch it
for a bonus. Be somewhere else and it sails past your end and smashes, and that
costs a life.

So does a mug you poured down an empty lane — it runs off the far end and
shatters. And so does a customer who reaches your end of the bar, because they
reach over and grab you by the collar.

Lose a life and the bar is swept: every mug in flight disappears and the
customers still standing are shoved back out of arm's reach. Lose your last one
and the night is over.

Clear a whole wave and the next level starts with more customers, walking
faster.

## Controls

| Input | Action |
|---|---|
| `↑` `↓` or `W` `S` | move up or down one bar |
| `Space` / `Enter` | pour and slide a mug (also starts, or restarts after game over) |
| Click the canvas | pour and slide a mug |
| `P` | pause |

## Scoring

| Event | Points |
|---|---|
| Customer served (pushed off the far end) | 150 |
| Empty mug caught | 50 |
| Wave cleared | 500 |

The best score is kept in `localStorage` under `sodatapper-best`.

## Strategy

- **Serve early.** A customer near the far end needs one mug; a customer
  halfway down needs three. The cost of ignoring a lane compounds.
- **Pouring is a commitment.** Every mug you send out is an empty you have to
  come back for, so do not pour into a lane you are about to leave.
- **Watch for two empties at once.** Two customers finishing in different lanes
  at the same moment is a life you cannot save — space out your pours so their
  drinks do not land together.
- **The far end of the bar is free.** A mug aimed at a customer who is nearly
  served still costs you nothing if it connects; it is only the miss that breaks
  glass.

## Implementation

See [DESIGN.md](DESIGN.md) for the mechanics, the tuning constants and the
assumptions taken where the original arcade game was ambiguous. The tests live
in `tests/sodatapper.spec.js` and drive `step(dt)` directly, so every timing
assertion is exact rather than wall-clock dependent.

```
npx playwright test SodaTapper/tests/
```
