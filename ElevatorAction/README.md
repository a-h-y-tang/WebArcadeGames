# Elevator Action

A six-storey document raid on an HTML5 canvas. You are a spy dropped onto the
roof of an enemy building: grab every secret document behind the red doors, ride
down to the ground floor and slip out of the escape door on the far left — while
enemy agents patrol the corridors and shoot on sight.

![Elevator Action](screenshot.png)

## Playing

Open `index.html` in any browser. There is no build step and no server.

## Controls

| Key | Action |
|---|---|
| <kbd>←</kbd> <kbd>→</kbd> (or <kbd>A</kbd> <kbd>D</kbd>) | Walk, or step off an elevator |
| <kbd>↑</kbd> <kbd>↓</kbd> (or <kbd>W</kbd> <kbd>S</kbd>) | Send the elevator you are riding up or down a floor |
| <kbd>Space</kbd> | Start the game; fire once you are playing |
| <kbd>P</kbd> | Pause / resume |

## How it works

Two elevator shafts cut through every floor, splitting each one into three
sealed segments. **A shaft opening is solid unless its car is level with your
floor**, so the elevators are the only way around the building — and the only
way down.

- Walk into a levelled car to board it; the spy snaps to the middle of the
  shaft. Press up or down to send the car one floor, and left or right to step
  off once it has arrived. A car in transit ignores input, and a spy between
  floors is untouchable: bullets and agents only reach you on a shared floor.
- **Red doors** hold the documents. Walk over one to take it (+100); the door
  turns grey and the `Docs` counter advances.
- **Grey doors** are scenery — and the hatches fresh agents step out of.
- **Space fires** in the direction you face, with a short cooldown. A hit agent
  is worth 200. An agent's bullet, or simply walking into one, costs a life.
- Reaching the ground floor **EXIT** with every document scores 1000 and loads
  the next floor plan. Three plans cycle, and agents get faster, more numerous
  and quicker on the trigger with every level.

Three lives, and your best score is remembered in `localStorage`.

## Tests

From the repository root:

```powershell
npx playwright test ElevatorAction/tests/
```

The suite drives the simulation frame by frame through the game's `step(dt)`
with `autoStep` switched off, so every spec is deterministic and independent of
`requestAnimationFrame` timing.

## Design

See [DESIGN.md](DESIGN.md) for the geometry, the update order and the
simplifying assumptions the implementation makes.
