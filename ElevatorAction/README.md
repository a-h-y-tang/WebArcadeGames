# Elevator Action

You came in through the roof. Six documents are behind six red doors, the street
exit is ten floors down and locked until you have all of them, and the building
has no stairs — only three elevator shafts, none of which runs the whole way.

## How to play

1. Press **Space**, or click **Start Game**.
2. Walk with **←/→** (or **A/D**) and ride a car with **↑/↓** (or **W/S**).
3. Stand in a **red door** and press **↑** to take the document.
4. Collect all six, then ride down to the **EXIT** on the bottom floor.

Three lives, three levels. Dying puts you back on the roof — the documents you
already took stay taken — and your best score is remembered between sessions.

## The elevators

No single shaft spans the building, so getting down is a relay:

| Shaft | Position | Floors it serves |
|---|---|---|
| A | left | 10 – 6 |
| B | middle | 7 – 3 |
| C | right | 4 – 1 |

Ride one car as far as it goes, step off onto a floor the next shaft also
reaches, walk across, ride on.

Corridors run the full width of the building, so you walk straight across an
empty shaft. To ride, stand on a car that is **level with your floor** and press
**↑** or **↓**. The lamp on the front of a car turns green whenever it is level
and safe to step out of — brake as you come up on a floor and it settles exactly
in line. A car you leave behind stays where you left it, which is worth
remembering when you need to come back up.

## Doors and gunfire

| | |
|---|---|
| **Red door** | a document. Stand in it and press **↑**. Worth 500. |
| **Blue door** | where the building's agents come out. |
| **EXIT** | bottom floor, right-hand side. Opens on the sixth document. |

Enemy agents walk at you and shoot along your floor. **Space** shoots back —
three bullets in the air at a time, worth 300 each.

Their bullets fly at chest height, so holding **↓** on a floor crouches under
them. Crouching also stops you walking, which is the whole trade: you are safe
but you are not getting anywhere, and more agents are coming out of the blue
doors while you wait. (Standing on a level car, **↓** rides it down instead of
crouching — step off the car first if you need to duck.)

## Controls

| Input | Action |
|---|---|
| `←` `→` / `A` `D` | walk, or step out of a car that is level with a floor |
| `↑` `↓` / `W` `S` | drive the car you are standing in |
| `↑` / `W` at a red door | take the document |
| `↓` / `S` on a floor | crouch — or ride down, if you are standing on a car |
| `Space` | shoot, or start / dismiss an overlay |
| `P` | pause and unpause |

## Scoring

| Event | Points |
|---|---|
| Document taken | 500 |
| Enemy agent shot | 300 |
| Level cleared | 1000 |

Each level raises the number of agents in the building, how fast they walk and
how quickly they replace themselves. Clear all three to win the run.

## Tips

- Take the document on the way past, not on a second trip. The corridor gets
  more crowded every time you walk it.
- Shoot down the corridor *before* you step out of the car. You can see the
  whole floor from inside the shaft.
- The strip down the right-hand edge marks the floors that still hold a
  document, and where in the building you are.
- Riding past a floor is free; the agents on it cannot touch you inside a moving
  car. Only stop where you actually need something.
- Enemy agents never ride, so a floor you have already stripped of agents stays
  clear for a while — but they roam the whole corridor, so there is nowhere on a
  floor to simply wait one out.

## Files

- `index.html` — page shell, HUD, canvas and overlay
- `style.css` — presentation
- `game.js` — simulation, rendering and input
- `tests/elevator-action.spec.js` — Playwright suite (written before the game)
- `DESIGN.md` — how the code works and why the numbers are what they are
