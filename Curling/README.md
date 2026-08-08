# Curling

A three-end game of curling against the computer, played on an HTML5 canvas.
Open `index.html` in any browser — there is no build step and no server needed.

![Curling](screenshot.png)

## How to play

You throw the red stones, the computer throws the yellow. Each end you get four
stones each and you take turns delivering them from the hack at the bottom of
the sheet toward the house at the top.

When all eight stones have come to rest, the team with a stone nearest the
button scores one point for **every** stone of theirs that is closer than the
opponent's nearest stone. Only stones touching the rings count. If nobody is in
the house the end is blank and nobody scores. Highest total after three ends
wins.

Three things decide where a stone finishes:

- **Weight** — how hard you throw it. Too light and it will be hogged (removed
  for failing to cross the far red line); too heavy and it runs out through the
  back of the house.
- **Line** — the direction you aim.
- **Handle** — the rotation you put on the stone. A clockwise handle bends the
  stone to the right as it travels, counter-clockwise to the left. Slow stones
  travel for longer and so curl further, which is how you draw around a guard.

Stones already on the ice are live: hit one and both stones carry on, so you can
knock the computer's stone out of the house or promote your own into it.

## Controls

| Input | Action |
|---|---|
| Move the mouse over the sheet | aim at the pointer |
| <kbd>&larr;</kbd> / <kbd>&rarr;</kbd> | fine-tune the line |
| <kbd>&uarr;</kbd> / <kbd>&darr;</kbd> or mouse wheel | adjust the weight |
| <kbd>Q</kbd> | counter-clockwise handle (curls left) |
| <kbd>W</kbd> | no handle (runs straight) |
| <kbd>E</kbd> | clockwise handle (curls right) |
| <kbd>Space</kbd> or click the sheet | deliver the stone |
| <kbd>Enter</kbd> | start the match, or move on to the next end |
| <kbd>R</kbd> | new match |

While you are aiming, a dashed line shows the path your stone would take with
the current settings and a red circle marks where it would stop if nothing were
in the way — the rest of the judgement is yours.

## Tips

- A draw to the button is around 57 weight. Anything over about 80 is takeout
  weight and will carry the stone out the back if it misses.
- Put a guard in front of the house early, then draw behind it with the handle
  that bends your stone in.
- Last stone of the end is worth a lot. Count what is lying before you throw it:
  a takeout that removes the shot stone can swing the end by several points.

## Development

The game is three files — `index.html`, `style.css` and `game.js` — with no
dependencies. `DESIGN.md` explains how the physics, scoring and opponent work.

Run the tests from the repository root:

```powershell
npx playwright test Curling/tests/
```
