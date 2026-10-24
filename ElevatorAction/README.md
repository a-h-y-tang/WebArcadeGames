# Elevator Action

A spy drops in on the top floor of a ten-storey building. Five red doors hide
the documents; the basement hides a getaway car. Between them are elevators,
stairwells, and a building full of agents who shoot on sight.

Open `index.html` in any modern browser — there is no build step and nothing to
install.

## How to play

1. You start on the top floor (floor 9). The building scrolls as you move.
2. Walk into a **red door** to grab the document behind it. There are five, one
   per floor, and the HUD counts them down.
3. Work your way down by **elevator** or **stairwell**. The shafts split each
   floor into three, so sometimes you have to call a car over just to cross.
4. **Agents** step out of the plain grey doors. Shoot them, or crouch so their
   shots pass overhead — a standing hit costs a life, and so does walking into
   one.
5. With all five documents in hand, reach the basement and walk left into the
   getaway car to escape.

## Controls

| Key | Action |
|---|---|
| &larr; &rarr; or A D | Walk |
| &uarr; &darr; or W S | Ride the elevator you are standing on, climb a stairwell |
| &darr; or S | Crouch (when you are not standing on a stairwell) |
| Space | Shoot |
| E or Enter | Call a car to your floor (stand by a shaft doorway) |
| P | Pause |
| Space / Start | Begin, or start again after a game over |

When Down is pressed the game picks, in order: drive the elevator, enter the
stairwell, crouch.

## Elevators and stairwells

* An elevator car only moves while you are riding it, so a car you leave
  behind stays where you parked it. Stand beside a shaft and press **E** to
  call the nearest car to your floor — the plates beside the doorway light up
  when you are close enough.
* A shaft with no car in front of you is a wall — you cannot fall down it.
* A car that is level with a floor doubles as a bridge, so you can walk
  straight across the shaft as well as ride.
* Stairwells join adjacent floors and always exist for every pair, so there is
  always a way down even with both cars parked badly.

## Scoring

| Event | Points |
|---|---|
| Document collected | 500 |
| Agent shot | 100 |
| Escape | 2000 |
| Each life left on escape | 250 |

Your best score is kept in `localStorage`.

## Tests

From the repository root:

```powershell
npx playwright test ElevatorAction/tests/
```

The suite freezes the animation loop (`autoRun = false`) and steps the
simulation itself, so every assertion runs against an exact number of fixed
timesteps rather than wall-clock timing.

See [DESIGN.md](DESIGN.md) for the model behind the building, the mechanics and
the assumptions made while building it.
