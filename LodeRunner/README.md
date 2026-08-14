# Lode Runner

Sweep every gold bar out of the vault, then climb the escape ladder — while
guards who never get tired chase you through the floors.

You cannot jump and you cannot fight. You carry a shovel, and a hole in a brick
floor is the only thing standing between you and a guard.

Open `index.html` in a browser. No build step, no server.

## How to play

| Key | Action |
|---|---|
| `←` `→` or `A` `D` | Run, and swing along bars |
| `↑` `↓` or `W` `S` | Climb ladders, drop off a bar |
| `Z` or `,` | Dig the brick down and to your left |
| `X` or `.` | Dig the brick down and to your right |
| `Space` / `Enter` | Start, or restart after a game over |
| `P` | Pause |

Collect all the gold and the hidden escape ladder appears at the top of the
board. Climb it to the top row to clear the level and move on to the next
vault.

## Things worth knowing

- **You can only dig brick.** The darker blue stone is permanent, and so is a
  brick with something sitting on top of it. You also have to be standing on
  solid ground — no digging from a ladder, a bar, or mid-air.
- **Holes heal.** A hole flashes red just before it closes. Anything still in
  it gets crushed: a guard is buried for 250 points, and you lose a life.
- **A trapped guard is a floor.** While a guard is stuck in a hole you can run
  straight over its head, which is often the only way past.
- **You fall through your own holes.** Digging down is how you get to the floor
  below in a hurry.
- **Bars are not nets.** Falling past a bar does not catch you — you have to
  step onto one from the side.
- **Guards get faster every level** but they can never outrun you in a straight
  line. They can, however, corner you.

## Scoring

| Event | Points |
|---|---|
| Gold bar | 150 |
| Guard buried | 250 |
| Level cleared | 1000 |

Your best score is kept in the browser's local storage.

## Levels

Three hand-built vaults — *Copper Mine*, *Steel Vault* and *Sky Refinery* —
cycle in order, with the guards quickening each time round.

## Development

See [DESIGN.md](DESIGN.md) for how the simulation works.

Tests live in `tests/` and run from the repository root:

```powershell
npx playwright test LodeRunner/tests/
```
