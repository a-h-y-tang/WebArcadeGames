# Elevator Action

You are on the roof of a ten-storey building full of enemy agents. The secret
documents are behind the **red doors**. Get them all, ride down to the garage,
and drive away before the building gets you.

## How to play

1. Press **Space**, or click **Start Game**.
2. Walk the floor with **←/→** (or **A/D**).
3. Stand in an elevator shaft where the car is waiting and press **↑/↓** to
   board it, then hold **↑/↓** to ride. Press **←/→** at a floor to step off.
4. Walk into a red door to take the documents inside.
5. With every document in hand, reach the **getaway car** in the garage on the
   ground floor.

Three lives. A bullet or an agent's touch costs one of them and sends you back
to the roof — but the documents you already have stay collected.

## Controls

| Key | Action |
|---|---|
| **←** / **→**, **A** / **D** | Walk, or step out of an elevator |
| **↑** / **↓**, **W** / **S** | Board and drive an elevator |
| **↓** / **S** (on a floor) | Duck |
| **Space** | Shoot |
| **P** | Pause |
| Click the board | Start / shoot |

## The two rules worth knowing

**A shaft is a hole.** You can only walk across a shaft when its car is level
with the floor you are on. If the car is six floors down, that side of the
building is out of reach until you fetch it — the two shafts are the only way
around the building, so plan where you leave a car.

The getaway car sits past the **right-hand shaft**, so the car you ride into
the garage decides whether you can walk to it. Arrive in the left-hand elevator
and you will have to go back up and fetch the other one.

**Ducking saves your life.** Agents fire at chest height, so a bullet sails
straight over a ducked player. Your own shot from a duck still hits an agent,
so ducking only costs you movement: you cannot walk while down. Standing still
in front of a drawn gun does not end well.

## Scoring

| Event | Points |
|---|---|
| Documents from a red door | 500 |
| Agent shot | 300 |
| Clearing a building | 1000 × building number |

Three buildings make a full run, each with more documents, more agents and
faster elevators than the last. Your best score is kept between sessions.

## Running it

Open `index.html` in any browser — no build step, no server, no assets.

Tests live in `tests/` and run with Playwright from the repository root:

```powershell
npx playwright test ElevatorAction/tests/
```

[DESIGN.md](DESIGN.md) explains how the code is put together.
