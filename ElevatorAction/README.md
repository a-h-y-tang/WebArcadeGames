# Elevator Action

A spy drops onto the roof of a seven-storey building. Red doors hide secret
documents, grey doors hide enemy agents, and two elevators are the only way
between floors. Loot every red door, then reach the getaway car in the basement
garage.

Open `index.html` in a browser — no build step, no server.

## How to play

1. You start on the top floor. Walk to a shaft; if that shaft's car is level
   with your floor you can step straight onto it.
2. Standing on a car, hold <kbd>&uarr;</kbd> or <kbd>&darr;</kbd> to drive it.
   Stop level with a floor and walk off either side.
3. Walk into a **red** door to take the document behind it. The counter in the
   HUD tells you how many are left.
4. Grey doors are where the agents come from. Shoot them, or duck under their
   fire.
5. With every document in hand the getaway car in the garage lights up. Reach
   it and the level is yours.

A car you stepped off stays where you left it, so you can always get back on
it — but the *other* car stays where you left *it* too, which is what makes
reaching the far side of a floor a puzzle.

## Controls

| Key | Action |
|---|---|
| <kbd>&larr;</kbd> <kbd>&rarr;</kbd> / <kbd>A</kbd> <kbd>D</kbd> | Walk |
| <kbd>&uarr;</kbd> <kbd>&darr;</kbd> / <kbd>W</kbd> <kbd>S</kbd> | Drive the elevator you are standing on |
| <kbd>&darr;</kbd> / <kbd>S</kbd> | Duck (standing on a floor) |
| <kbd>Space</kbd> | Shoot — also starts the game and clears an overlay |
| <kbd>P</kbd> | Pause |

Ducking makes you short enough that bullets pass overhead, but you cannot walk
or shoot while you are down.

## Scoring

| Event | Points |
|---|---|
| Document | 500 |
| Agent | 200 |
| Escape | 1000 + 100 per level |

Three lives. A hit costs one and puts you back on the roof with the documents
you have already banked. Your best score is kept in the browser.

Each level asks for one more document (up to six), and sends more agents, faster
and firing sooner.

## Tests

```powershell
npx playwright test ElevatorAction/tests/
```

## How it works

See [DESIGN.md](DESIGN.md).
