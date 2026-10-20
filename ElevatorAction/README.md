# Elevator Action

Drop onto the roof of a ten-storey building, raid every red door for the secret
documents inside, ride the elevators down past the enemy agents, and escape
through the lobby.

## How to play

Open `index.html` in any browser — there is no build step and no server needed.

| Input | Action |
|---|---|
| <kbd>←</kbd> <kbd>→</kbd> / <kbd>A</kbd> <kbd>D</kbd> | walk |
| <kbd>↑</kbd> <kbd>↓</kbd> / <kbd>W</kbd> <kbd>S</kbd> | drive the elevator you are standing on — or, standing on a floor, call the nearer car to you |
| <kbd>Space</kbd> / click | shoot (and start or continue from an overlay) |
| <kbd>P</kbd> | pause |

## The rules

- Five **red doors** are hidden in the building, one each on five different
  floors. Walk into a red doorway to take the document inside — worth 500.
- **Grey doors** are where the enemy agents come from. A shot drops one for 150;
  their shots, and bumping into them, cost a life. You have three, and a knock
  shoves you clear so the moment of grace is actually usable.
- The two **elevators** are the only way between floors. Stand on a car and
  press up or down to drive it one floor; hold the key to keep going, and it
  pauses at each floor on the way so you can let go and step off. A car always
  stops level with a floor, so you can walk straight off it.
- Standing on a floor, up or down works the **call button** instead and brings
  the nearer car to you — so a drop down an empty shaft is never a dead end.
  Pressing the other way while a car is moving turns it round.
- Agents can only reach you on their own floor. Ride past one and you are out
  of its reach; stop level with its floor and you are not.
- A shaft with no car in it is a hole. Falling down one is safe — you land on
  the next car roof or in the lobby — and is often the fastest way down.
- The lobby **EXIT** stays shut until the last document is in hand. Once it
  lights up, reach it for 1000 plus 250 for every life you have left.
- Three buildings make a full run. Each one sends out agents faster, more of
  them, and quicker on their feet. Clearing a building hands back a life, up to
  five.

Your best score is kept in the browser between sessions.

## Files

| File | What it is |
|---|---|
| `index.html` | page, HUD and overlay markup |
| `style.css` | presentation |
| `game.js` | the whole game: model, simulation and canvas rendering |
| `DESIGN.md` | how the code works, the constants, and the design decisions |
| `tests/elevator-action.spec.js` | the Playwright suite |

## Tests

From the repository root:

```powershell
npx playwright test ElevatorAction/tests/
```
