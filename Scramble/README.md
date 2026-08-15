# Scramble

A side-scrolling cave flyer on an HTML5 canvas. Fly right through a winding
cave that never stops scrolling, blast the fuel tanks on the floor to keep the
tank from running dry, and dodge the rockets that launch as you close in.

![Scramble](screenshot.png)

## Playing

Open `index.html` in a browser — no build step or server required.

## Controls

| Key | Action |
|---|---|
| ↑ / W | Climb |
| ↓ / S | Dive |
| ← / A | Hold back |
| → / D | Speed up |
| Space | Fire laser (also starts a run) |
| B | Drop bomb |
| P | Pause / resume |

## How it works

- **Fuel is the clock.** It burns from the moment you start and the only refill
  is a fuel tank parked on the cave floor — destroy one with a bomb or a laser
  and you get 25 units back. Running dry costs a life, same as hitting rock.
- **The fuel is where the danger is.** Tanks sit on the ground, so refuelling
  means flying low, in the part of the cave that kills you.
- **Rockets launch when you get close.** They climb and lean towards you. Shoot
  them early or fly over the top.
- **Reach the end of the cave** to clear the level and bank a bonus of 500 plus
  5 per unit of fuel left. The next cave is longer, faster and tighter.

Three lives. A crash restarts the current cave with a full tank; your score
carries over. Best score is saved in your browser.

### Scoring

| Target | Points |
|---|---|
| Fuel tank | 150 (+25 fuel) |
| Rocket | 80 |
| Level cleared | 500 + 5 × fuel remaining |

## Development

See [DESIGN.md](DESIGN.md) for how the code is put together and what was
assumed while building it.

Run the tests from the repo root:

```powershell
npx playwright test Scramble/tests/
```
