# Scramble

Fly a jet through a scrolling cavern. Your fuel is always draining — the only
way to reach the base at the far end is to bomb the fuel dumps on the cave
floor along the way.

![Scramble](screenshot.png)

## How to play

Open `index.html` in a browser and press <kbd>Space</kbd>.

| Input | Action |
|---|---|
| <kbd>←</kbd> <kbd>→</kbd> <kbd>↑</kbd> <kbd>↓</kbd> or <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> | Fly |
| <kbd>Space</kbd> | Fire laser (also starts the game) |
| <kbd>B</kbd> or <kbd>X</kbd> | Drop bomb |
| <kbd>P</kbd> | Pause / resume |

## The catch

A full tank lasts about **45 seconds**. The run takes about **65**. You cannot
fly your way out of that — you have to go down into the cave and bomb fuel
tanks to stay in the air.

- **Bombing** a fuel tank gives you **+22 fuel** and 80 points.
- **Shooting** a fuel tank gives you the 80 points and *burns the fuel away*.

The laser is the safe weapon. It is also the wrong one when the gauge is low.

## What is out there

| | Threat | Points |
|---|---|---|
| **Fuel tank** | Refuels you when bombed | 80 |
| **Rocket** | Sits on the floor, launches straight up when you get close | 50 |
| **UFO** | Drifts through the cave, bobbing | 100 |

Rockets rise in a narrow column — change altitude to slip past one, or shoot it
once it climbs into your lane.

## Zones

Four stretches of cave, each rougher than the last: **CAVERNS** → **PEAKS** →
**TUNNEL** (low roof) → **CITY**. The start of each zone is a checkpoint. Crash
and you restart from there with a full tank, keeping everything you already
destroyed.

## Scoring

Reaching the base pays **1000 points plus 5 per unit of fuel left over**, so
efficient bombing beats cautious hoarding. Your best score is kept in
`localStorage`.

You start with 3 ships.

## Tests

```powershell
npx playwright test Scramble/tests/
```

70 Playwright tests cover level generation, flight, fuel, both weapons, every
enemy, crashing and checkpoints, pausing, and the win condition.
