# Elevator Action

You are a secret agent dropped on the roof of an eight-floor building. Four
**red doors** hide the documents you came for. Ride the two elevators down,
loot every red door, and slip out through the **EXIT** on the ground floor —
while the building's guards walk out of the ordinary doors and shoot back.

## How to play

1. Press **Space**, or click **Start Game**. The agent lands on the top floor.
2. Walk with **←/→** (or **A/D**).
3. Step into an elevator shaft and press **↑/↓** (or **W/S**):
   - the car is on your floor → you board it and it sets off,
   - the car is somewhere else → it is called to your floor,
   - you are already riding → the car moves one floor.
4. Press **←/→** while a car is stopped to step out onto that floor.
5. Press **Space** to shoot. Guards go down in one hit; so do you.
6. Take all four documents, then reach the ground-floor exit. The exit only
   opens once the last document is in the bag.

Three lives. A hit sends you back to the roof with a moment of grace, but the
documents you already collected stay collected. Your best score is remembered
between sessions.

## Scoring

| Event | Points |
|---|---|
| Document taken from a red door | 500 |
| Guard shot | 150 |
| Building cleared | 1000 |
| Each life still in hand when you escape | 100 |

Every cleared building sends more guards, faster, and they reload quicker — so
a fast, quiet run is worth far more than a shoot-out.

## Controls

| Input | Action |
|---|---|
| `←` `→` / `A` `D` | walk, and step out of a stopped elevator |
| `↑` `↓` / `W` `S` | call a car, board it, or drive it one floor |
| `Space` | start, shoot, or dismiss an overlay |
| `P` | pause and unpause |

## Tips

- A guard with its back turned needs a moment to spin round before it can
  fire. That moment is your shot.
- Guards never use the elevators. Riding between floors is always safe, and a
  stopped car is a good place to watch a corridor from.
- Hiding does not work: most guards are sent to your floor or the one above or
  below it, and any guard left patrolling an empty floor withdraws and is
  replaced by one sent after you.
- A called car travels empty — press **↑** early so it is waiting for you by
  the time you have cleared the floor.
- The documents are always spread over four different floors, never on the
  ground floor, so plan the trip down rather than wandering.

## Files

- `index.html` — page shell, HUD, canvas and overlay
- `style.css` — cabinet styling
- `game.js` — simulation and rendering
- `DESIGN.md` — how the game works internally, and the assumptions behind it
- `tests/elevator-action.spec.js` — Playwright suite

Run the tests from the repository root:

```powershell
npx playwright test ElevatorAction/tests/
```
