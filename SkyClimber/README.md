# Sky Climber

A vertical climbing arcade game on an HTML5 canvas, in the spirit of *Crazy
Climber*. You scale the face of a skyscraper hand over hand while the building
does its best to shake you off: windows slam shut on your fingers and flower
pots rain down from the roof. Reach the top, then start on a taller building.

![Sky Climber](screenshot.png)

## Playing

Open `index.html` in any modern browser. No build step and no server required.

## Controls

| Input | Action |
|---|---|
| `W` `S` | raise / lower the **left** hand |
| `↑` `↓` | raise / lower the **right** hand |
| `A` `D` / `←` `→` | shift both hands one column sideways |
| `Space` / `Enter` | start (or restart after a game over) |
| `P` | pause / resume |

Holding a hand key repeats the move, so you can climb by alternating holds
rather than tapping.

## How to play

**Climb hand over hand.** You hang from two adjacent windows, one hand on each.
A hand can only reach a window that is *open*, and it may never get more than one
row above or below its partner — so you rise by alternating: left, right, left,
right. Your height is measured by the lower of the two hands, and every new row
is worth 10 points.

**Read the wall.** Windows open and shut on their own timers. A window that is
about to shut flashes orange for a moment first — that flash is your cue to move
that hand somewhere else. If it shuts while you are holding it, your grip breaks
and you slide down to the nearest row where *both* of your columns are open.
The street ledge at the bottom is always open, so a slip costs height but never a
life.

**Dodge the pots.** Flower pots fall down single columns. One that reaches you
knocks you off the wall and costs a life. You dodge by stepping sideways — but a
sideways step needs both hands on the same row, so you cannot dodge in the middle
of a stride. Watch the red chevrons at the top of the screen: they mark the
column a pot is falling down before it comes into view.

**Reach the roof.** Get both hands onto the top row to clear the building — worth
500 × level — and the next building is three rows taller, with faster pots and
windows that cycle more quickly. You get three climbers; the best score is kept
between sessions.

## Files

| File | Contents |
|---|---|
| `index.html` | page shell — HUD, canvas, overlay, key legend |
| `style.css` | night-skyline theme |
| `game.js` | all game state and logic |
| `DESIGN.md` | how the code works, and the design decisions behind it |
| `tests/sky-climber.spec.js` | Playwright suite (52 tests) |

## Tests

From the repository root:

```powershell
npx playwright test SkyClimber/tests/
```
