# The Narrow Path

A tilting-board marble game in the wooden-labyrinth tradition.

> *"Narrow is the gate and difficult is the way which leads to life"* — Matthew 7:14

You lean a pilgrim's board and a round stone rolls across it under gravity.
Gather every **waymark** on a stage — *"Set up waymarks"*, Jeremiah 31:21 — and the
**narrow gate** at the far end swings open. Keep clear of the **ditches** beside the
road: fall in and you lose one of your three journeys, and the stone goes back to the
start of the stage.

Four stages, each narrower than the last: *The Village Road*, *The Winding Way*,
*The Steep Pass* and *The Narrow Gate*.

## Playing

Open `index.html` in any browser — no build step and no server needed.

| Input | Action |
|---|---|
| Arrow keys or WASD | Tilt the board |
| Space or Enter | Start a run, carry on from a pause, or play again |
| P | Pause / unpause |
| R | Start the run again from the first stage |
| Hold the pointer on the board | Tilt toward the pointer (works on a touch screen) |
| Start / Pause / Restart buttons | The same, for the mouse |

There is no way to nudge the stone directly: only the board tilts. Level it out and
let friction bring the stone to rest.

## Scoring

| | |
|---|---|
| Waymark gathered | 120 |
| Stage finished | 400 |
| Time bonus | 5 a second for every whole second of the stage's par left on the clock |

Your best score is kept in the browser's local storage.

## Tips

- Tap the tilt rather than holding it. A board left leaning builds up more speed than
  a one-cell corridor can take.
- Every ditch can be gone round — no stage ever asks you to roll across one.
- The gate stays barred, and does nothing at all, until the last waymark is gathered.

## Tests

The Playwright suite covers the stage layouts (including a check that every waymark
and the gate can be reached without crossing a ditch, and an autopilot that walks all
four stages without a single fall), the tilt, the rolling and wall collisions, the
ditches, the waymarks, the gate, stage progression, lives, scoring, the HUD, the
controls and the drawing.

```powershell
npx playwright test NarrowPath/tests/
```

`DESIGN.md` explains how the code is put together and lists the assumptions made
while building it.
