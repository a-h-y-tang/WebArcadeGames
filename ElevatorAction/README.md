# Elevator Action

You are dropped on the roof of a six-storey building with one job: empty every
**red** door of its secret documents and walk out of the **EXIT** on the ground
floor. The stairs are not an option — the two elevators are the only way down,
and enemy agents keep stepping out of the blue doors to stop you.

## How to play

1. Press **Space**, or click **Start Game**.
2. Walk the floor with **←/→** (or **A/D**) and step onto a red door to take
   the documents inside.
3. Walk into an elevator car that is level with your floor to board it, then
   drive it with **↑/↓** (or **W/S**).
4. Release the walk key and press **←** or **→** to step back out onto a floor.
5. With the `Docs` counter at zero, reach the lit **EXIT** on the ground floor.

Five buildings make a full run. Each one sends agents out faster and moves them
quicker than the last. Your best score is remembered between sessions.

## Fighting back

`Space` fires along the floor you are standing on. Agents stand full height, so
any shot that reaches one puts them down.

Their fire is always chest high — hold **↓** to crouch and it sails over your
hat. Crouching roots you in place and drops your own shots low, which still
kills a standing agent, so the duck-and-shoot exchange is the safest way to
clear a corridor you have to walk through.

An empty shaft is a wall: you stop at its edge rather than falling. A car
between two floors is a safe pocket — nothing on either floor can reach you,
and you cannot reach them either.

## Scoring

| Event | Points |
|---|---|
| Secret document | 300 |
| Agent shot | 150 |
| Building cleared | 500 |
| Each life still in hand at a clear | 200 |

Three lives. A bullet or a body check costs one and puts you back on the roof
with a moment of immunity; losing the last one ends the run.

## Controls

| Input | Action |
|---|---|
| `←` `→` / `A` `D` | walk; step out of a car level with a floor |
| `↑` `↓` / `W` `S` | drive the car you are riding |
| `↓` / `S` (on a floor) | crouch — ducks a high shot, fires low |
| `Space` | start, fire, or dismiss an overlay |
| `P` | pause and unpause |

## Tips

- Plan the descent, not just the fight: park a car on the floor you want to
  leave from before you go collecting, and you always have an exit.
- An agent turns around at a shaft, so the strip of floor beside a shaft is the
  best place to catch one coming back at you.
- Clearing a building pays 200 per surviving life, so a careful run is worth far
  more than a fast one.

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
