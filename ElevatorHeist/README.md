# Elevator Heist

A six-storey tower, three secret documents, two elevator cars and a building
full of security agents. Get in from the roof, find the documents, ride down,
and walk out of the ground-floor exit.

Open `index.html` in any browser — there is no build step and no server.

## How to play

You start on the roof level. Each of floors 0–4 has red office doors; three of
the six doors in the building hide a document. The only way between floors is an
elevator car, and the only place agents cannot shoot you is inside one.

1. Walk to a shaft while its car is level with your floor and press `↑` to step
   in.
2. Hold `↑` / `↓` to drive the car. Let go and it settles at the nearest floor.
3. Press `←` or `→` to step out — this only works when the car is level with a
   floor.
4. Stand in front of a red door and press `↑` to kick it open. A document scores
   200. An empty one has a security agent waiting behind it.
5. With all three documents the ground-floor `EXIT` lights up green. Reach it to
   escape and start the next, harder level (+500).

Shoot agents with `Space` for 150 each — three bullets in the air at most. An
agent's bullet, or simply bumping into one, costs a life; you have three, and
you restart on the roof with a moment of invulnerability. Agents cannot see you
while your car is between floors, so the shaft is where you go to think.

## Controls

| Input | Action |
|---|---|
| `←` `→` / `A` `D` | Walk; step out of a car (only when level with a floor) |
| `↑` `↓` / `W` `S` | Drive the car you are standing in |
| `↑` / `W` | Board a car level with you, or open the door in front of you |
| `Space` | Fire |
| `P` | Pause / resume |
| `Space` / `Start` | Begin a run, or restart after game over |

## Scoring

| Event | Points |
|---|---|
| Document recovered | 200 |
| Security agent dropped | 150 |
| Escape with all documents | 500 |

Your best score is kept in the browser's local storage.

## Difficulty

Each level adds a security agent (up to six) and makes them walk 6 px/s faster.
The door layout is generated from the level number, so a level always looks the
same but no two levels look alike.

## Tests

```powershell
npx playwright test ElevatorHeist/tests/
```

The suite drives the simulation directly — it freezes the animation loop
(`autoRun = false`) and calls `physicsStep(dt)` with a fixed timestep, so the
tests are deterministic rather than wall-clock dependent. See `DESIGN.md` for
how the code is laid out and which assumptions were made.
